require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const { randomUUID } = require("crypto");
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
app.use(cookieParser());
app.use(express.static("public"));

// Har browser ko ek anonymous unique ID do (cookie ke through)
// Isse alag-alag log ki chats alag-alag rahengi, bina login form ke
app.use((req, res, next) => {
  let visitorId = req.cookies.visitorId;
  if (!visitorId) {
    visitorId = randomUUID();
    res.cookie("visitorId", visitorId, {
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 saal tak yaad rahega
      httpOnly: true
    });
  }
  req.visitorId = visitorId;
  next();
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Bahut zyada messages bhej diye! Thoda ruk kar try karo." }
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/chat.html");
});

// ---------- CONVERSATIONS ----------

app.get("/api/conversations", (req, res) => {
  const db = loadDB();
  const list = db.conversations
    .filter(c => c.userId === req.visitorId)
    .map(c => ({ id: c.id, title: c.title }));
  res.json(list);
});

app.post("/api/conversations", (req, res) => {
  const db = loadDB();
  const newConv = { id: Date.now().toString(), userId: req.visitorId, title: "New Chat", messages: [] };
  db.conversations.push(newConv);
  saveDB(db);
  res.json({ id: newConv.id, title: newConv.title });
});

app.get("/api/conversations/:id", (req, res) => {
  const db = loadDB();
  const conv = db.conversations.find(c => c.id === req.params.id && c.userId === req.visitorId);
  if (!conv) return res.status(404).json({ error: "Conversation nahi mili" });
  res.json(conv);
});

app.delete("/api/conversations/:id", (req, res) => {
  const db = loadDB();
  db.conversations = db.conversations.filter(c => !(c.id === req.params.id && c.userId === req.visitorId));
  saveDB(db);
  res.json({ success: true });
});

// ---------- CHAT (STREAMING + MEMORY + PERSISTENCE) ----------

app.post("/api/chat-stream/:convId", chatLimiter, async (req, res) => {
  try {
    const db = loadDB();
    const conv = db.conversations.find(c => c.id === req.params.convId && c.userId === req.visitorId);
    if (!conv) return res.status(404).json({ error: "Conversation nahi mili" });

    const userMessage = req.body.message;
    conv.messages.push({ role: "user", content: userMessage });

    if (conv.messages.length === 1) {
      conv.title = userMessage.slice(0, 30);
    }

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
