import prisma from "../db.server";

// Public health check for uptime monitors / load balancers. Verifies the
// process is up AND can reach the database. No auth (no tenant data exposed).
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    return Response.json(
      { status: "error", error: String(error?.message ?? error) },
      { status: 503 },
    );
  }
};
