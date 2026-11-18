import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

const { MONGODB_URI, DB_NAME = "myproject", PORT = 3000 } = process.env;

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
const app = express();
app.use(express.json());

let users; // set after the database connects

// ---------- helpers ----------
const isValidEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const parseId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- routes ----------
app.get("/", (req, res) => res.json({ status: "ok" }));

// Create
app.post(
  "/users",
  asyncHandler(async (req, res) => {
    const { name, email } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "a valid email is required" });
    }

    const doc = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      createdAt: new Date(),
    };

    try {
      const result = await users.insertOne(doc);
      res.status(201).json({ _id: result.insertedId, ...doc });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "email already exists" });
      }
      throw err;
    }
  })
);

// Read all (with simple pagination)
app.get(
  "/users",
  asyncHandler(async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

    const [items, total] = await Promise.all([
      users
        .find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      users.countDocuments(),
    ]);

    res.json({ page, limit, total, items });
  })
);

// Read one
app.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const _id = parseId(req.params.id);
    if (!_id) return res.status(400).json({ error: "invalid id" });

    const user = await users.findOne({ _id });
    if (!user) return res.status(404).json({ error: "user not found" });
    res.json(user);
  })
);

// Update
app.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const _id = parseId(req.params.id);
    if (!_id) return res.status(400).json({ error: "invalid id" });

    const updates = {};
    if (req.body?.name !== undefined) {
      if (typeof req.body.name !== "string" || !req.body.name.trim()) {
        return res.status(400).json({ error: "name must be a non-empty string" });
      }
      updates.name = req.body.name.trim();
    }
    if (req.body?.email !== undefined) {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({ error: "email is invalid" });
      }
      updates.email = req.body.email.trim().toLowerCase();
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "nothing to update" });
    }
    updates.updatedAt = new Date();

    try {
      const result = await users.findOneAndUpdate(
        { _id },
        { $set: updates },
        { returnDocument: "after" }
      );
      if (!result) return res.status(404).json({ error: "user not found" });
      res.json(result);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "email already exists" });
      }
      throw err;
    }
  })
);

// Delete
app.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const _id = parseId(req.params.id);
    if (!_id) return res.status(400).json({ error: "invalid id" });

    const result = await users.deleteOne({ _id });
    if (result.deletedCount === 0) return res.status(404).json({ error: "user not found" });
    res.status(204).end();
  })
);

// ---------- error handling ----------
app.use((req, res) => res.status(404).json({ error: "route not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

// ---------- startup / shutdown ----------
async function start() {
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection("users");

  // Unique index so two users can't share an email
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ createdAt: -1 });

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
