import "dotenv/config";
import { MongoClient } from "mongodb";

const services = [
  {
    serviceName: "Signature Cut & Blow Dry",
    category: "Haircut & Styling",
    description:
      "A personalised consultation followed by a precision cut, relaxing wash and a polished blow dry finish.",
    price: 45,
    duration: 60,
    image:
      "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Gloss & Tone Hair Coloring",
    category: "Hair Coloring",
    description:
      "Shine-boosting gloss colour treatment tailored to your tone, leaving hair glossy and full of dimension.",
    price: 85,
    duration: 90,
    image:
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Deep Repair Keratin Treatment",
    category: "Hair Treatment",
    description:
      "An intensive keratin mask that smooths frizz, repairs damage and restores softness to tired hair.",
    price: 70,
    duration: 75,
    image:
      "https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Glow Ritual Facial",
    category: "Facial & Skincare",
    description:
      "A calming cleanse, exfoliation and hydrating mask designed to leave your skin fresh, bright and glowing.",
    price: 60,
    duration: 60,
    image:
      "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Soft Glam Makeup Session",
    category: "Makeup",
    description:
      "A professional soft glam look with skin prep, long-wear base, sculpted eyes and a flawless finish.",
    price: 95,
    duration: 75,
    image:
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Luxury Manicure & Gel Polish",
    category: "Manicure & Pedicure",
    description:
      "Cuticle care, shaping and a long-lasting gel polish in the shade of your choice for beautifully neat nails.",
    price: 40,
    duration: 50,
    image:
      "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Aromatherapy Spa Massage",
    category: "Spa & Massage",
    description:
      "A 60-minute full body massage with warm aromatherapy oils to release tension and restore calm.",
    price: 80,
    duration: 60,
    image:
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Bridal Hair & Makeup Package",
    category: "Makeup",
    description:
      "A complete wedding-day package including a trial-inspired updo, radiant makeup and final touch-ups.",
    price: 180,
    duration: 120,
    image:
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Scalp Detox & Hydration Ritual",
    category: "Hair Treatment",
    description:
      "A soothing scalp cleanse with a nourishing hydration mask that balances and refreshes the roots.",
    price: 55,
    duration: 45,
    image:
      "https://images.unsplash.com/photo-1519415943484-9fa1873496d4?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
  {
    serviceName: "Classic Pedicure & Foot Care",
    category: "Manicure & Pedicure",
    description:
      "A warm soak, gentle exfoliation, nail shaping and foot massage finished with a classic polish.",
    price: 50,
    duration: 55,
    image:
      "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1200&q=80",
    status: "active",
  },
];

const client = new MongoClient(process.env.DB_URI);
try {
  await client.connect();
  const db = client.db("SalonBook");
  const collection = db.collection("services");

  const existing = await collection.countDocuments();
  if (existing > 0) {
    console.log(`Skipped seeding: ${existing} services already exist.`);
  } else {
    const now = new Date();
    await collection.insertMany(
      services.map((service) => ({ ...service, createdAt: now, updatedAt: now }))
    );
    console.log(`Seeded ${services.length} salon services.`);
  }
} catch (error) {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
} finally {
  await client.close();
}
