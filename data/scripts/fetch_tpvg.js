const fs = require("fs");
const https = require("https");

// mapa šifri kolodvora
const STATION_CODES = {
  "72303": "ZAGREB RANŽIRNI (OS)",
  "72304": "ZAGREB RANŽIRNI (PS)",
  "ZAGREB ZAP. KOL.": "ZAGREB ZAPADNI",
  "72302": "ZAGREB ŽITNJAK",
  "73164": "NOVO DRNJE",
  "71308": "BRČKO - izvan HŽ",
  "74609": "ĐURMANEC granica",
  "78804": "SLAVONSKI ŠAMAC granica",
  "92515": "PREČEC stajalište",
  "73115": "GRADEC stajalište",
  "77424": "BUZET granica",
  "71020": "TOVARNIK granica",
  "KOPRIVNICA GR A": "KOPRIVNICA granica",
  "SAVSKI MAROF GRANICA": "SAVSKI MAROF granica",
  "72480": "ZAGREB GLAVNI"
};
function translateStation(station) {
  if (!station) return station;

  const s = station.trim();

  if (STATION_CODES[s]) {
    return STATION_CODES[s];
  }

  return station;
}

function parseTpvgStatus(raw, headerTime) {
  const now = new Date().toISOString();

  const clean = raw.trim();
  // završetak vožnje (lokomotiva stoji u kolodvoru)
const finalStationMatch = clean.match(/Trenutna pozicija je u kolodvoru\s+(\d+)\s+([A-ZČĆŽŠĐ0-9\s.\-]+)/i);

if (finalStationMatch) {
  return {
    type: "Rasformiran",
    station: translateStation(finalStationMatch[2].trim()),
    train_number: null,
    event_time: headerTime || now,
    seen_at: now,
    raw: clean
  };
}

  // 1) nema podataka
  if (/^nema podataka$/i.test(clean)) {
    return {
      type: "Nema podataka",
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
      type: "Izvan HŽ",
      station: outHzMatch[1],
      train_number: null,
      event_time: null,
      seen_at: now,
      raw: clean
    };
  }

  // pomoćne regexe
  const trainMatch = clean.match(/Br\.?\s*vlaka\s*\.{0,2}\s*(\d{3,5})/i);
  const dateTimeMatch = clean.match(/(\d{2})\.(\d{2})\.(\d{2})\.\s+(\d{2}):(\d{2})/);
  const stationMatch = clean.match(/kolodvor\s+([A-ZČĆŽŠĐ0-9\s.\-]+)/i);

  let event_time = null;
  if (dateTimeMatch) {
    const [_, d, m, y, hh, mm] = dateTimeMatch;
    event_time = `20${y}-${m}-${d}T${hh}:${mm}:00`;
  }

  const train_number = trainMatch ? trainMatch[1] : null;
  const station = stationMatch ? translateStation(stationMatch[1]) : null;

  // 3) eksplicitni prometni događaji
  const EVENT_KEYWORDS = [
    { key: "formiran", type: "Formiran" },
    { key: "odlazak", type: "Odlazak" },
    { key: "dolazak", type: "Dolazak" },
    { key: "prolazak", type: "Odlazak" },
    { key: "promjena sas", type: "Promjena sastava" },
    { key: "pretrasiran", type: "Pretrasiran" },
    { key: "raspušten", type: "Raspušten" }
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
      type: "Dolazak",
      station,
      train_number,
      event_time,
      seen_at: now,
      raw: clean
    };
  }

  // 5) fallback (za svaki nepoznati format)
  return {
    type: "Nepoznato",
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
  "927820620247",
  "927820620254",
  "927820620262",
  "927820620387",
  "927820622011",
  "927820622029",
  "927820622037",
  "927820621104",
  "927820440232",
  "927820440026",
  "927820440067",
  "927820440125",
  "927820440240",
  "927820440265",
  "927820621195",
  "987821320346",
  "987821323035",
  "987821323118",
  "928012230035",
  "928012230050",
  "928012230076",
  "928012230100",
  "928012230142",
  "927820623019",
  "927820623027", //infra dole
  "987893113470",
  "997894100012",
  "997894853487",
  "997894855706",
  "987891162040",
  "987891162057",
  "987891213314",
  "997896853188",
  "987891113316",
  
];

// učitaj postojeće podatke
let history = [];
try {
  history = JSON.parse(fs.readFileSync("data/lokomotive.json", "utf8"));
} catch {
  history = [];
}

function fetchTPVG(uic) {
  return new Promise((resolve) => {
    const url = `https://tpvg.hzinfra.hr:7777/?vag=${uic}`;

    const req = https.get(url, (res) => {
      let data = "";

      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });

    // timeout 8 sekundi
    req.setTimeout(8000, () => {
      req.destroy();
      resolve("");
    });

    req.on("error", () => resolve(""));
  });
}

(async () => {
  const BATCH_SIZE = 10;
let results = [];

for (let i = 0; i < UIC_LIST.length; i += BATCH_SIZE) {
  const batch = UIC_LIST.slice(i, i + BATCH_SIZE);

  const batchResults = await Promise.all(
    batch.map(async (uic) => {
      const html = await fetchTPVG(uic);
      return { uic, html };
    })
  );

  results = results.concat(batchResults);
}

for (const { uic, html } of results) {
    // vrijeme iz TPVG zaglavlja (Tekuća evidencija)
let headerTime = null;

const headerTimeMatch = html.match(/(\d{2})\.(\d{2})\.(\d{2})\.\s*u\s*(\d{2}):(\d{2})/i);

if (headerTimeMatch) {
  const [_, d, m, y, hh, mm] = headerTimeMatch;
  headerTime = `20${y}-${m}-${d}T${hh}:${mm}:00`;
}

    // vrlo jednostavno parsiranje (kasnije možemo poboljšati)
    let statusText = "Nema podataka";

// standardni prometni zapisi
const statusMatch = html.match(/(Br\. vlaka[^<]+|nema podataka|izvan HŽ[^<]+)/i);

if (statusMatch) {
  statusText = statusMatch[0].trim();
}


// završetak vožnje (trenutna pozicija u kolodvoru)
const finalMatch = html.match(/>\s*(\d{4,6})\s+([A-ZČĆŽŠĐ0-9\s.\-]+)\s*</);

if (!statusMatch && finalMatch) {
  statusText = `Trenutna pozicija je u kolodvoru ${finalMatch[1]} ${finalMatch[2]}`;
}

// ako postoji red koji počinje s kolodvor (rasformiranje)
const stationLine = html.match(/kolodvor\s+[A-ZČĆŽŠĐ0-9\s.\-]+[^<]*/i);

if (!statusMatch && stationLine) {
  statusText = stationLine[0].trim();
}
    
    const parsedEvent = parseTpvgStatus(statusText, headerTime);
    if (parsedEvent.type === "Nema podataka") continue;

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
