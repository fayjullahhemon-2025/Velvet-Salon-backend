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

// GET /services/featured (or /api/services/featured)
// Fetches 6 active featured services (supports ?limit=6)
const getFeaturedServicesHandler = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(24, Number(req.query.limit) || 6));
    const services = await servicesCollection
      .find({ status: "active" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return res.json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/services/featured", getFeaturedServicesHandler);
app.get("/api/services/featured", getFeaturedServicesHandler);

// GET /services (or /api/services)
// Query params: status (active | inactive | all), category, search, limit, sort (price_asc, price_desc, duration_asc, duration_desc, name_asc, name_desc, newest)
const getServicesHandler = async (req, res) => {
  try {
    const { status, category, search, sort, limit } = req.query;
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

    // Sorting via API
    if (sort === "price_asc") {
      cursor = cursor.sort({ price: 1 });
    } else if (sort === "price_desc") {
      cursor = cursor.sort({ price: -1 });
    } else if (sort === "duration_asc") {
      cursor = cursor.sort({ duration: 1 });
    } else if (sort === "duration_desc") {
      cursor = cursor.sort({ duration: -1 });
    } else if (sort === "name_asc") {
      cursor = cursor.sort({ serviceName: 1 });
    } else if (sort === "name_desc") {
      cursor = cursor.sort({ serviceName: -1 });
    } else if (sort === "newest") {
      cursor = cursor.sort({ createdAt: -1 });
    } else {
      cursor = cursor.sort({ createdAt: -1 });
    }

    // Limit if specified
    if (limit) {
      const numLimit = Number(limit);
      if (!isNaN(numLimit) && numLimit > 0) {
        cursor = cursor.limit(numLimit);
      }
    }

    const services = await cursor.toArray();
    return res.json({ success: true, count: services.length, data: services });
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

// POST /services (or /api/services) - Admin Only
const createServiceHandler = async (req, res) => {
  try {
    const { serviceName, category, description, price, duration, image, status } = req.body;

    // Validate required fields
    if (!serviceName || !serviceName.trim()) {
      return res.status(400).json({ success: false, error: "Service Name is required." });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ success: false, error: "Service Category is required." });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, error: "Description is required." });
    }
    if (!image || !image.trim()) {
      return res.status(400).json({ success: false, error: "Service image is required." });
    }

    // Price must be a positive number
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ success: false, error: "Price must be a positive number." });
    }

    // Duration must be a positive number
    const numDuration = Number(duration);
    if (isNaN(numDuration) || numDuration <= 0) {
      return res.status(400).json({ success: false, error: "Duration must be a positive number." });
    }

    const newService = {
      serviceName: serviceName.trim(),
      category: category.trim(),
      description: description.trim(),
      price: numPrice,
      duration: Math.round(numDuration),
      image: image.trim(),
      status: status === "inactive" ? "inactive" : "active", // Default: active
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);
    return res.status(201).json({
      success: true,
      data: { _id: result.insertedId, ...newService },
      message: "Service created successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.post("/services", requireAdmin, createServiceHandler);
app.post("/api/services", requireAdmin, createServiceHandler);


// PUT /services/:id (or /api/services/:id) - Admin Only
const updateServiceHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid service ID" });
    }

    const { serviceName, category, description, price, duration, image, status } = req.body;
    const updateDoc = { updatedAt: new Date() };

    if (serviceName && serviceName.trim()) updateDoc.serviceName = serviceName.trim();
    if (category && category.trim()) updateDoc.category = category.trim();
    if (description && description.trim()) updateDoc.description = description.trim();
    if (image && image.trim()) updateDoc.image = image.trim();
    if (status === "active" || status === "inactive") updateDoc.status = status;

    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        return res.status(400).json({ success: false, error: "Price must be a positive number." });
      }
      updateDoc.price = numPrice;
    }

    if (duration !== undefined) {
      const numDuration = Number(duration);
      if (isNaN(numDuration) || numDuration <= 0) {
        return res.status(400).json({ success: false, error: "Duration must be a positive number." });
      }
      updateDoc.duration = Math.round(numDuration);
    }

    const result = await servicesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateDoc },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: "Service not found." });
    }

    return res.json({
      success: true,
      data: result,
      message: "Service updated successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.put("/services/:id", requireAdmin, updateServiceHandler);
app.put("/api/services/:id", requireAdmin, updateServiceHandler);

// PATCH /services/:id/status (or /api/services/:id/status) - Admin Only
const toggleStatusHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid service ID" });
    }

    const { status } = req.body;
    if (status !== "active" && status !== "inactive") {
      return res.status(400).json({ success: false, error: "Status must be 'active' or 'inactive'." });
    }

    const result = await servicesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: "Service not found." });
    }

    return res.json({
      success: true,
      data: result,
      message: `Service status updated to ${status}.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.patch("/services/:id/status", requireAdmin, toggleStatusHandler);
app.patch("/api/services/:id/status", requireAdmin, toggleStatusHandler);

// DELETE /services/:id (or /api/services/:id) - Admin Only
const deleteServiceHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid service ID" });
    }

    const result = await servicesCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: "Service not found." });
    }

    return res.json({ success: true, message: "Service deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.delete("/services/:id", requireAdmin, deleteServiceHandler);
app.delete("/api/services/:id", requireAdmin, deleteServiceHandler);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
