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
const appointmentsCollection = db.collection("appointments");
const transactionsCollection = db.collection("transactions");

// Helper to look up user from either 'user' or 'users' collection
const findUser = async (query) => {
  return (
    (await db.collection("user").findOne(query)) ||
    (await db.collection("users").findOne(query))
  );
};

// Admin authorization guard middleware
const requireAdmin = async (req, res, next) => {
  try {
    const userRole = req.headers["x-user-role"];
    const userEmail = req.headers["x-user-email"];

    if (userRole === "admin") {
      if (userEmail) {
        const user = await findUser({ email: userEmail });
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
      const user = await findUser({ email: userEmail });
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

// Customer authorization guard middleware
// Rule: Only authenticated Customers can submit appointment requests. Admins cannot book customer appointments.
const requireCustomer = async (req, res, next) => {
  try {
    const userRole = req.headers["x-user-role"];
    const userEmail = req.headers["x-user-email"];

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Please sign in as a customer to perform this action.",
      });
    }

    const user = await findUser({ email: userEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: User account not found.",
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Your account has been suspended.",
      });
    }

    if (user.role === "admin" || userRole === "admin") {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Administrators cannot book customer appointments. Please use a customer account.",
      });
    }

    req.currentUser = user;
    return next();
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

// ==========================================
// APPOINTMENTS API
// ==========================================

// GET /appointments/booked-slots (or /api/appointments/booked-slots)
// Query params: serviceId, date
const getBookedSlotsHandler = async (req, res) => {
  try {
    const { serviceId, date } = req.query;
    if (!serviceId || !date) {
      return res.status(400).json({
        success: false,
        error: "serviceId and date query parameters are required.",
      });
    }

    const bookedDocs = await appointmentsCollection
      .find({
        serviceId: String(serviceId),
        appointmentDate: String(date),
        status: { $in: ["pending", "confirmed"] },
      })
      .project({ timeSlot: 1 })
      .toArray();

    return res.json({
      success: true,
      bookedSlots: bookedDocs.map((d) => d.timeSlot),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/appointments/booked-slots", getBookedSlotsHandler);
app.get("/api/appointments/booked-slots", getBookedSlotsHandler);

// POST /appointments (or /api/appointments)
// Rules:
// 1. Only authenticated Customers can submit appointment requests.
// 2. Prevent customers from booking inactive services.
// 3. Prevent duplicate active appointments for the same date and time slot.
// 4. Default Appointment Status: Pending; Default Payment Status: Unpaid.
const createAppointmentHandler = async (req, res) => {
  try {
    const { serviceId, appointmentDate, timeSlot, message } = req.body;

    if (!serviceId || !ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, error: "Valid service ID is required." });
    }

    // 1. Service validation
    const service = await servicesCollection.findOne({ _id: new ObjectId(serviceId) });
    if (!service) {
      return res.status(404).json({ success: false, error: "Service not found." });
    }

    // Rule: Prevent customers from booking inactive services
    if (service.status !== "active") {
      return res.status(400).json({
        success: false,
        error: "This service is currently inactive and cannot be booked.",
      });
    }

    // 2. Date validation
    if (!appointmentDate || typeof appointmentDate !== "string") {
      return res.status(400).json({ success: false, error: "Appointment date is required." });
    }

    const todayStr = new Date().toISOString().split("T")[0];
    if (appointmentDate < todayStr) {
      return res.status(400).json({
        success: false,
        error: "Appointment date cannot be in the past.",
      });
    }

    // 3. Time slot validation
    if (!timeSlot || typeof timeSlot !== "string" || !timeSlot.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please select an available appointment time slot.",
      });
    }
    const cleanSlot = timeSlot.trim();

    // 4. Rule: Prevent duplicate active appointments for the same date and time slot
    // Check if slot is already booked for this service
    const existingServiceBooking = await appointmentsCollection.findOne({
      serviceId: String(service._id),
      appointmentDate,
      timeSlot: cleanSlot,
      status: { $in: ["pending", "confirmed"] },
    });
    if (existingServiceBooking) {
      return res.status(409).json({
        success: false,
        error: "This time slot is already booked for this service. Please choose another time slot.",
      });
    }

    // Check if this customer already has an active booking at the exact same date and time slot
    const customerId = req.currentUser?._id
      ? String(req.currentUser._id)
      : req.headers["x-user-id"] || "";

    if (customerId) {
      const existingCustomerBooking = await appointmentsCollection.findOne({
        customerId: String(customerId),
        appointmentDate,
        timeSlot: cleanSlot,
        status: { $in: ["pending", "confirmed"] },
      });
      if (existingCustomerBooking) {
        return res.status(409).json({
          success: false,
          error: "You already have an active appointment booked for this date and time slot.",
        });
      }
    }

    const newAppointment = {
      serviceId: String(service._id),
      customerId: String(customerId),
      customerName: req.currentUser?.name || req.headers["x-user-name"] || "Customer",
      customerEmail: req.currentUser?.email || req.headers["x-user-email"] || "",
      serviceName: service.serviceName,
      serviceImage: service.image,
      serviceCategory: service.category,
      servicePrice: service.price,
      appointmentDate,
      timeSlot: cleanSlot,
      message: message ? String(message).trim() : "",
      paymentStatus: "unpaid", // Default
      status: "pending", // Default
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await appointmentsCollection.insertOne(newAppointment);

    return res.status(201).json({
      success: true,
      data: { _id: result.insertedId, ...newAppointment },
      message: "Appointment request submitted successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.post("/appointments", requireCustomer, createAppointmentHandler);
app.post("/api/appointments", requireCustomer, createAppointmentHandler);

// GET /appointments (or /api/appointments)
// Query params: customerId, serviceId, status, date
const getAppointmentsHandler = async (req, res) => {
  try {
    const { customerId, serviceId, status, date } = req.query;
    const query = {};

    const userRole = req.headers["x-user-role"];
    const userEmail = req.headers["x-user-email"];

    // If caller is customer, lock query to their customerId or email
    if (userRole !== "admin") {
      if (userEmail) {
        const user = await findUser({ email: userEmail });
        if (user) {
          query.$or = [{ customerId: String(user._id) }, { customerEmail: user.email }];
        } else if (customerId) {
          query.customerId = String(customerId);
        }
      } else if (customerId) {
        query.customerId = String(customerId);
      }
    } else {
      // Admin can filter by customerId if provided
      if (customerId) query.customerId = String(customerId);
    }

    if (serviceId) query.serviceId = String(serviceId);
    if (date) query.appointmentDate = String(date);
    if (status && status !== "all") query.status = status;

    const appointments = await appointmentsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({
      success: true,
      count: appointments.length,
      data: appointments,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/appointments", getAppointmentsHandler);
app.get("/api/appointments", getAppointmentsHandler);



// GET /appointments/:id (or /api/appointments/:id)
const getSingleAppointmentHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid appointment ID" });
    }

    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });
    if (!appointment) {
      return res.status(404).json({ success: false, error: "Appointment not found." });
    }

    return res.json({ success: true, data: appointment });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/appointments/:id", getSingleAppointmentHandler);
app.get("/api/appointments/:id", getSingleAppointmentHandler);



// PATCH /appointments/:id/cancel (or /api/appointments/:id/cancel)
// Rules:
// - A customer can cancel only their own pending appointment requests.
// - Admin can cancel pending or confirmed appointment requests.
const cancelAppointmentHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid appointment ID" });
    }

    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });
    if (!appointment) {
      return res.status(404).json({ success: false, error: "Appointment not found." });
    }

    if (appointment.status === "cancelled") {
      return res.status(400).json({ success: false, error: "This appointment is already cancelled." });
    }

    const userRole = req.headers["x-user-role"];
    const userEmail = req.headers["x-user-email"];

    if (userRole === "admin") {
      // Admin can cancel pending or confirmed appointments
      const updated = await appointmentsCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { status: "cancelled", updatedAt: new Date() } },
        { returnDocument: "after" }
      );
      return res.json({
        success: true,
        data: updated,
        message: "Appointment cancelled successfully by admin.",
      });
    }

    // Customer cancellation
    if (!userEmail) {
      return res.status(401).json({ success: false, error: "Unauthorized: Sign-in required." });
    }

    const user = await findUser({ email: userEmail });
    if (!user) {
      return res.status(401).json({ success: false, error: "User not found." });
    }

    // Ownership check
    const isOwner =
      appointment.customerId === String(user._id) ||
      appointment.customerEmail === user.email;

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: You can only cancel your own appointments.",
      });
    }

    // Rule: Customer can cancel ONLY pending appointments
    if (appointment.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: "You can only cancel pending appointment requests. Confirmed appointments cannot be cancelled online.",
      });
    }

    const updated = await appointmentsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    return res.json({
      success: true,
      data: updated,
      message: "Your appointment request has been cancelled successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.patch("/appointments/:id/cancel", cancelAppointmentHandler);
app.patch("/api/appointments/:id/cancel", cancelAppointmentHandler);



// PATCH /appointments/:id/status (or /api/appointments/:id/status) - Admin Only
// Rules:
// - Admin can confirm or cancel appointment requests.
// - Only pending appointments can be confirmed.
const updateAppointmentStatusHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid appointment ID" });
    }

    const { status } = req.body;
    if (status !== "confirmed" && status !== "cancelled") {
      return res.status(400).json({
        success: false,
        error: "Status must be 'confirmed' or 'cancelled'.",
      });
    }

    const existing = await appointmentsCollection.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Appointment not found." });
    }

    // Rule: Only pending appointments can be confirmed
    if (status === "confirmed" && existing.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: `Only pending appointments can be confirmed. Current status is '${existing.status}'.`,
      });
    }

    // Rule: Cannot cancel an already cancelled appointment
    if (status === "cancelled" && existing.status === "cancelled") {
      return res.status(400).json({
        success: false,
        error: "This appointment is already cancelled.",
      });
    }

    const updated = await appointmentsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    return res.json({
      success: true,
      data: updated,
      message: `Appointment successfully marked as ${status}.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.patch("/appointments/:id/status", requireAdmin, updateAppointmentStatusHandler);
app.patch("/api/appointments/:id/status", requireAdmin, updateAppointmentStatusHandler);

// ==========================================
// USER PROFILE API (CUSTOMERS & ADMINS)
// ==========================================

// GET /users/profile (or /api/users/profile)
const getProfileHandler = async (req, res) => {
  try {
    const userEmail = req.headers["x-user-email"];
    const userId = req.headers["x-user-id"];

    if (!userEmail && !userId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Sign-in required." });
    }

    let user = null;
    if (userId && ObjectId.isValid(userId)) {
      user = await findUser({ _id: new ObjectId(userId) });
    }
    if (!user && userEmail) {
      user = await findUser({ email: userEmail });
    }

    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found." });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, error: "Forbidden: Account is suspended." });
    }

    return res.json({
      success: true,
      data: {
        _id: String(user._id),
        name: user.name || "",
        email: user.email || "",
        image: user.image || "",
        phone: user.phone || "",
        role: user.role || "customer",
        isBlocked: Boolean(user.isBlocked),
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/users/profile", getProfileHandler);
app.get("/api/users/profile", getProfileHandler);

// PATCH /users/profile (or /api/users/profile)
// Rules:
// 1. Users can update: Name, Profile Image, Other Basic Profile Info (phone).
// 2. Users must not be able to change their own role or blocked status through profile updates.
// 3. Users must not be able to update another user's profile.
const updateProfileHandler = async (req, res) => {
  try {
    const userEmail = req.headers["x-user-email"];
    const userId = req.headers["x-user-id"];

    if (!userEmail && !userId) {
      return res.status(401).json({ success: false, error: "Unauthorized: Sign-in required." });
    }

    let user = null;
    if (userId && ObjectId.isValid(userId)) {
      user = await findUser({ _id: new ObjectId(userId) });
    }
    if (!user && userEmail) {
      user = await findUser({ email: userEmail });
    }

    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found." });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, error: "Forbidden: Account is suspended." });
    }

    const { name, image, phone } = req.body;
    const updateDoc = { updatedAt: new Date() };

    // Update name if provided
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ success: false, error: "Name cannot be empty." });
      }
      updateDoc.name = name.trim();
    }

    // Update image if provided
    if (image !== undefined) {
      updateDoc.image = typeof image === "string" ? image.trim() : "";
    }

    // Update phone if provided
    if (phone !== undefined) {
      updateDoc.phone = typeof phone === "string" ? phone.trim() : "";
    }

    // Security check: Guardrail strictly prevents role or isBlocked modifications
    // (Never include req.body.role or req.body.isBlocked)

    // Update in the primary user collection
    const targetCollection = (await db.collection("user").findOne({ _id: user._id }))
      ? db.collection("user")
      : db.collection("users");

    const updated = await targetCollection.findOneAndUpdate(
      { _id: user._id },
      { $set: updateDoc },
      { returnDocument: "after" }
    );

    return res.json({
      success: true,
      data: {
        _id: String(updated._id),
        name: updated.name || "",
        email: updated.email || "",
        image: updated.image || "",
        phone: updated.phone || "",
        role: updated.role || "customer",
        isBlocked: Boolean(updated.isBlocked),
      },
      message: "Profile updated successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.patch("/users/profile", updateProfileHandler);
app.patch("/api/users/profile", updateProfileHandler);

// ==========================================
// ADMIN USER MANAGEMENT API
// ==========================================

// GET /users (or /api/users) - Admin Only
// Query params: role (default: "customer" or "all"), status ("all" | "active" | "blocked"), search
const getUsersHandler = async (req, res) => {
  try {
    const { role, status, search } = req.query;
    const query = {};

    if (role && role !== "all") {
      query.role = role;
    } else if (!role) {
      // Default to registered customers
      query.role = "customer";
    }

    if (status === "active") {
      query.isBlocked = { $ne: true };
    } else if (status === "blocked") {
      query.isBlocked = true;
    }

    if (search && search.trim()) {
      const reg = { $regex: search.trim(), $options: "i" };
      query.$or = [{ name: reg }, { email: reg }];
    }

    // Look up in primary collection
    const targetCollection = (await db.collection("user").countDocuments()) > 0
      ? db.collection("user")
      : db.collection("users");

    const users = await targetCollection.find(query).sort({ createdAt: -1 }).toArray();

    // Map and count user appointments
    const formatted = await Promise.all(
      users.map(async (u) => {
        const appointmentCount = await appointmentsCollection.countDocuments({
          $or: [{ customerId: String(u._id) }, { customerEmail: u.email }],
        });

        return {
          _id: String(u._id),
          name: u.name || "Customer",
          email: u.email || "",
          image: u.image || "",
          phone: u.phone || "",
          role: u.role || "customer",
          isBlocked: Boolean(u.isBlocked),
          createdAt: u.createdAt,
          totalAppointments: appointmentCount,
        };
      })
    );

    return res.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/users", requireAdmin, getUsersHandler);
app.get("/api/users", requireAdmin, getUsersHandler);

// GET /users/:id (or /api/users/:id) - Admin Only
const getUserDetailsHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid user ID." });
    }

    const user = await findUser({ _id: new ObjectId(id) });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const appointmentCount = await appointmentsCollection.countDocuments({
      $or: [{ customerId: String(user._id) }, { customerEmail: user.email }],
    });

    return res.json({
      success: true,
      data: {
        _id: String(user._id),
        name: user.name || "Customer",
        email: user.email || "",
        image: user.image || "",
        phone: user.phone || "",
        role: user.role || "customer",
        isBlocked: Boolean(user.isBlocked),
        createdAt: user.createdAt,
        totalAppointments: appointmentCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/users/:id", requireAdmin, getUserDetailsHandler);
app.get("/api/users/:id", requireAdmin, getUserDetailsHandler);

// PATCH /users/:id/block (or /api/users/:id/block) - Admin Only
// Block or Unblock User
const toggleBlockUserHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid user ID." });
    }

    const user = await findUser({ _id: new ObjectId(id) });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    // Safety guardrail: Admin cannot block themselves
    const adminEmail = req.headers["x-user-email"];
    const adminId = req.headers["x-user-id"];
    if (user.email === adminEmail || String(user._id) === String(adminId)) {
      return res.status(400).json({
        success: false,
        error: "Administrators cannot block their own account.",
      });
    }

    const { isBlocked } = req.body;
    const blockFlag = Boolean(isBlocked);

    const targetCollection = (await db.collection("user").findOne({ _id: user._id }))
      ? db.collection("user")
      : db.collection("users");

    const updated = await targetCollection.findOneAndUpdate(
      { _id: user._id },
      { $set: { isBlocked: blockFlag, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    return res.json({
      success: true,
      data: {
        _id: String(updated._id),
        name: updated.name,
        email: updated.email,
        role: updated.role,
        isBlocked: Boolean(updated.isBlocked),
      },
      message: blockFlag
        ? `Customer "${updated.name}" has been blocked.`
        : `Customer "${updated.name}" has been unblocked.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.patch("/users/:id/block", requireAdmin, toggleBlockUserHandler);
app.patch("/api/users/:id/block", requireAdmin, toggleBlockUserHandler);

// -------------------------------------------------------------
// TRANSACTIONS ROUTES
// -------------------------------------------------------------
const getTransactionsHandler = async (req, res) => {
  try {
    const rawTransactions = await transactionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({
      success: true,
      data: rawTransactions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getTransactionByIdHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const query = ObjectId.isValid(id)
      ? { $or: [{ _id: new ObjectId(id) }, { stripeSessionId: id }] }
      : { stripeSessionId: id };

    const transaction = await transactionsCollection.findOne(query);
    if (!transaction) {
      return res.status(404).json({ success: false, error: "Transaction not found." });
    }

    return res.json({ success: true, data: transaction });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

app.get("/transactions", getTransactionsHandler);
app.get("/api/transactions", getTransactionsHandler);
app.get("/transactions/:id", getTransactionByIdHandler);
app.get("/api/transactions/:id", getTransactionByIdHandler);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
