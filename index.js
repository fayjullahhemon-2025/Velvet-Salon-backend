import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// DB connection
const client = new MongoClient(process.env.MONGODB_URL);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectedDB = await connectToMongoDB();
const db = connectedDB.db("Velvet-Saloon-DB");

const servicesCollection = db.collection("services");
const usersCollection = db.collection("user");

// Admin authorization guard middleware
const requireAdmin = async (req, res, next) => {
  try {
    const userRole = req.headers["x-user-role"];
    const userEmail = req.headers["x-user-email"];

    if (userRole === "admin") {
      if (userEmail) {
        const user = await usersCollection.findOne({ email: userEmail });
        if (user?.isBlocked) {
          return res.status(403).json({
            success: false,
            error: "Forbidden: Account is suspended.",
          });
        }
      }
      return next();
    }

    if (userEmail) {
      const user = await usersCollection.findOne({ email: userEmail });
      if (user?.role === "admin" && !user.isBlocked) {
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      error: "Forbidden: Admin access required.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Health Check
app.get("/", (req, res) => {
  res.send("Velvet Saloon Server is running....");
});

// ==========================================
// SERVICES API (PUBLIC & ADMIN)
// ==========================================

// GET /services (or /api/services)
// Query params: status (active | inactive | all), category, search, sort (price_asc, price_desc, duration_asc, duration_desc, newest)
const getServicesHandler = async (req, res) => {
  try {
    const { status, category, search, sort } = req.query;
    const query = {};

    // Filter by status:
    // If status is "all", don't filter.
    // If status is specified (e.g. "active" or "inactive"), use it.
    // Default for public callers without "all" is "active".
    if (status && status !== "all") {
      query.status = status;
    } else if (status !== "all" && req.headers["x-user-role"] !== "admin") {
      query.status = "active";
    }

    // Filter by category
    if (category && category !== "all" && category.trim()) {
      query.category = category.trim();
    }

    // Search by service name
    if (search && search.trim()) {
      query.serviceName = { $regex: search.trim(), $options: "i" };
    }

    let cursor = servicesCollection.find(query);

    // Sorting
    if (sort === "price_asc") {
      cursor = cursor.sort({ price: 1 });
    } else if (sort === "price_desc") {
      cursor = cursor.sort({ price: -1 });
    } else if (sort === "duration_asc") {
      cursor = cursor.sort({ duration: 1 });
    } else if (sort === "duration_desc") {
      cursor = cursor.sort({ duration: -1 });
    } else if (sort === "newest") {
      cursor = cursor.sort({ createdAt: -1 });
    } else {
      cursor = cursor.sort({ createdAt: -1 });
    }

    const services = await cursor.toArray();
    return res.json({ success: true, data: services });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/services", getServicesHandler);
app.get("/api/services", getServicesHandler);

// GET /services/:id (or /api/services/:id)
const getSingleServiceHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid service ID" });
    }

    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
    if (!service) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }

    return res.json({ success: true, data: service });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/services/:id", getSingleServiceHandler);
app.get("/api/services/:id", getSingleServiceHandler);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
