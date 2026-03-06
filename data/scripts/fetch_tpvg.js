const fs = require("fs");
const https = require("https");



function parseTpvgStatus(raw) {
  const now = new Date().toISOString();

  const clean = raw.trim();

  // 1) nema podataka
  if (/^nema podataka$/i.test(clean)) {
    return {
      type: "nema podataka",
      station: null,
      train_number: null,
      event_time: null,
      seen_at: now,
      raw: clean
    };
  }

  // 2) izvan HŽ
  const outHzMatch = clean.match(/izvan HŽ\s+(\d+)/i);
  if (outHzMatch) {
    return {
      type: "izvan HŽ",
      station: outHzMatch[1],
      train_number: null,
      event_time: null,
      seen_at: now,
      raw: clean
    };
  }

  // pomoćne regexe
  const trainMatch = clean.match(/Br\. vlaka\s+(\d+)/i);
  const dateTimeMatch = clean.match(/(\d{2})\.(\d{2})\.(\d{2})\.\s+(\d{2}):(\d{2})/);
  const stationMatch = clean.match(/kolodvor\s+([A-ZČĆŽŠĐ\s-]+)/i);

  let event_time = null;
  if (dateTimeMatch) {
    const [_, d, m, y, hh, mm] = dateTimeMatch;
    event_time = `20${y}-${m}-${d}T${hh}:${mm}:00`;
  }

  const train_number = trainMatch ? trainMatch[1] : null;
  const station = stationMatch ? stationMatch[1].trim() : null;

  // 3) eksplicitni prometni događaji
  const EVENT_KEYWORDS = [
    { key: "formiran", type: "formiran" },
    { key: "odlazak", type: "odlazak" },
    { key: "dolazak", type: "dolazak" },
    { key: "prolazak", type: "prolazak" },
    { key: "promjena sas", type: "promjena sastava" },
    { key: "pretrasiran", type: "pretrasiran" },
    { key: "raspušten", type: "raspušten" }
  ];

  for (const ev of EVENT_KEYWORDS) {
    if (clean.toLowerCase().includes(ev.key)) {
      return {
        type: ev.type,
        station,
        train_number,
        event_time,
        seen_at: now,
        raw: clean
      };
    }
  }

  // 4) implicitno rasformiranje / stajanje
  // ima datum + kolodvor, ali NEMA prometni glagol
  if (event_time && station) {
    return {
      type: "stajanje",
      interpreted_as: "rasformiran",
      station,
      train_number,
      event_time,
      seen_at: now,
      raw: clean
    };
  }

  // 5) fallback (za svaki nepoznati format)
  return {
    type: "nepoznato",
    station,
    train_number,
    event_time,
    seen_at: now,
    raw: clean
  };
}



// 🔧 OVDJE UPISUJEŠ UIC BROJEVE
const UIC_LIST = [
  "927820620171",
  "927820440141",
  "927820620189",
  "927820620197",
  "927820620247"
];

// učitaj postojeće podatke
let history = [];
try {
  history = JSON.parse(fs.readFileSync("data/lokomotive.json", "utf8"));
} catch {
  history = [];
}

function fetchTPVG(uic) {
  return new Promise((resolve, reject) => {
    const url = `https://tpvg.hzinfra.hr:7777/?vag=${uic}`;

    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

(async () => {
  for (const uic of UIC_LIST) {
    const html = await fetchTPVG(uic);

    // vrlo jednostavno parsiranje (kasnije možemo poboljšati)
    let statusText = "nema podataka";

// pokušaj izvući cijeli red sa statusom
const statusMatch = html.match(/(Br\. vlaka[^<]+|nema podataka|izvan HŽ[^<]+)/i);

if (statusMatch) {
  statusText = statusMatch[0].trim();
}

// ako postoji red koji počinje s kolodvor (rasformiranje)
const stationLine = html.match(/kolodvor\s+[A-ZČĆŽŠĐ\s-]+[^<]*/i);

if (!statusMatch && stationLine) {
  statusText = stationLine[0].trim();
}
    
    const parsedEvent = parseTpvgStatus(statusText);
    if (parsedEvent.type === "nema podataka") continue;

    function getLastEventForUIC(uic, history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].uic === uic) return history[i];
  }
  return null;
}

    

    const last = getLastEventForUIC(uic, history);

if (!last || last.raw !== parsedEvent.raw) {
  history.push({
    uic,
    ...parsedEvent
  });
}
  }

// ⏱ zadrži samo zadnjih 72 sata
const NOW = Date.now();
const HOURS_72 = 72 * 60 * 60 * 1000;

history = history.filter(e => {
  const t = new Date(e.seen_at || e.time).getTime();
  return NOW - t <= HOURS_72;
});
  
  fs.writeFileSync(
    "data/lokomotive.json",
    JSON.stringify(history, null, 2)
  );
})();
