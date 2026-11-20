import { getCollection, toIdString, toObjectId } from "../db/mongo.js";
import { serializeService, serializeUser } from "./serializers.js";

function uniqueObjectIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const objectId = toObjectId(value);
    if (!objectId) continue;
    const key = objectId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(objectId);
  }
  return result;
}

export async function populateAppointments(docs) {
  if (!docs?.length) return [];

  const serviceIds = uniqueObjectIds(docs.map((doc) => doc.serviceId));
  const customerIds = uniqueObjectIds(docs.map((doc) => doc.customerId));

  const [services, customers] = await Promise.all([
    serviceIds.length
      ? getCollection("services").find({ _id: { $in: serviceIds } }).toArray()
      : [],
    customerIds.length
      ? getCollection("user")
          .find({ _id: { $in: customerIds } })
          .project({ name: 1, email: 1, image: 1, phone: 1 })
          .toArray()
      : [],
  ]);

  const serviceMap = new Map(services.map((doc) => [toIdString(doc._id), doc]));
  const customerMap = new Map(customers.map((doc) => [toIdString(doc._id), doc]));

  return docs.map((doc) => {
    const service = serviceMap.get(toIdString(doc.serviceId));
    const customer = customerMap.get(toIdString(doc.customerId));
    return {
      id: toIdString(doc._id),
      serviceId: toIdString(doc.serviceId),
      customerId: toIdString(doc.customerId),
      appointmentDate: doc.appointmentDate,
      timeSlot: doc.timeSlot,
      message: doc.message || "",
      servicePrice: doc.servicePrice,
      paymentStatus: doc.paymentStatus,
      status: doc.status,
      createdAt: doc.createdAt,
      service: service
        ? serializeService(service)
        : {
            id: toIdString(doc.serviceId),
            serviceName: "Service no longer available",
            category: "Removed",
            description: "",
            price: doc.servicePrice,
            duration: 0,
            image: "",
            status: "inactive",
          },
      customer: customer
        ? serializeUser(customer)
        : {
            id: toIdString(doc.customerId),
            name: "Deleted customer",
            email: "",
            image: "",
            phone: "",
          },
    };
  });
}
