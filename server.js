require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { loadDB, saveDB } = require("./db");

const app = express();
const PORT = 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-flash-latest",
  systemInstruction: `Tum H & N Tech ka ek helpful AI assistant ho.
Tum kisi bhi topic mein madad kar sakte ho — general knowledge, coding, writing, problem-solving, ya kuch bhi.
Hamesha clear, friendly aur practical jawab do. Code dikhana ho to markdown code blocks use karo.
User Hindi/Hinglish mein baat kare to usi tarah jawab do, English mein kare to English mein.`
});

app.use(express.json());
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-please",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 din tak login yaad rahega
}));

// Spam se bachne ke liye: 1 minute mein max 20 messages per user
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Bahut zyada messages bhej diye! Thoda ruk kar try karo." }
});

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Pehle login karo" });
  next();
}

// ---------- AUTH ----------

app.post("/api/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username aur password dono chahiye" });

    const db = loadDB();
    if (db.users.find(u => u.username === username)) {
      return res.status(400).json({ error: "Ye username pehle se hai, dusra try karo" });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), username, password: hash };
    db.users.push(newUser);
    saveDB(db);

    req.session.userId = newUser.id;
    res.json({ success: true, username });
  } catch (err) {
    res.status(500).json({ error: "Signup mein error: " + err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = loadDB();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: "Galat username ya password" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Galat username ya password" });

    req.session.userId = user.id;
    res.json({ success: true, username });
  } catch (err) {
    res.status(500).json({ error: "Login mein error: " + err.message });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  res.json({ loggedIn: true, username: user ? user.username : null });
});

// ---------- CONVERSATIONS ----------

app.get("/api/conversations", requireLogin, (req, res) => {
  const db = loadDB();
  const list = db.conversations
    .filter(c => c.userId === req.session.userId)
    .map(c => ({ id: c.id, title: c.title }));
  res.json(list);
});

app.post("/api/conversations", requireLogin, (req, res) => {
  const db = loadDB();
  const newConv = { id: Date.now().toString(), userId: req.session.userId, title: "New Chat", messages: [] };
  db.conversations.push(newConv);
  saveDB(db);
  res.json({ id: newConv.id, title: newConv.title });
});

app.get("/api/conversations/:id", requireLogin, (req, res) => {
  const db = loadDB();
  const conv = db.conversations.find(c => c.id === req.params.id && c.userId === req.session.userId);
  if (!conv) return res.status(404).json({ error: "Conversation nahi mili" });
  res.json(conv);
});

app.delete("/api/conversations/:id", requireLogin, (req, res) => {
  const db = loadDB();
  db.conversations = db.conversations.filter(c => !(c.id === req.params.id && c.userId === req.session.userId));
  saveDB(db);
  res.json({ success: true });
});

// ---------- CHAT (STREAMING + MEMORY + PERSISTENCE) ----------

app.post("/api/chat-stream/:convId", requireLogin, chatLimiter, async (req, res) => {
  try {
    const db = loadDB();
    const conv = db.conversations.find(c => c.id === req.params.convId && c.userId === req.session.userId);
    if (!conv) return res.status(404).json({ error: "Conversation nahi mili" });

    const userMessage = req.body.message;
    conv.messages.push({ role: "user", content: userMessage });

    if (conv.messages.length === 1) {
      conv.title = userMessage.slice(0, 30);
    }

    // Purani history Gemini ke format mein convert karo (memory ke liye)
    const history = conv.messages.slice(0, -1).map(m => ({
      role: m.role === "bot" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const chatSession = model.startChat({ history });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const result = await chatSession.sendMessageStream(userMessage);
    let fullText = "";

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      res.write(chunkText);
    }

    conv.messages.push({ role: "bot", content: fullText });
    saveDB(db);
    res.end();

  } catch (error) {
    console.error("Error:", error);
    if (!res.headersSent) res.status(500);
    res.write("Sorry, kuch error aa gaya: " + error.message);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server chal raha hai! Browser mein kholo: http://localhost:${PORT}`);
});
