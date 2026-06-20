// Ye file simple JSON-based "database" hai
// (Asli production app mein MySQL/MongoDB use hota hai, lekin beginner ke liye ye simple aur reliable hai)

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], conversations: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { loadDB, saveDB };
