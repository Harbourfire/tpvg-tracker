const fs = require("fs");
const https = require("https");

// 🔧 OVDJE UPISUJEŠ UIC BROJEVE
const UIC_LIST = [
  "927820620171"
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
    const match = html.match(/Br\. Vlaka([^<]+)/);

    const entry = {
      uic,
      info: match ? match[0].trim() : "nema podataka",
      time: new Date().toISOString()
    };

    history.push(entry);
  }

  fs.writeFileSync(
    "data/lokomotive.json",
    JSON.stringify(history, null, 2)
  );
})();
