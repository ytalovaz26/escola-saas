import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 1x1 JPG transparente (na prática só pra matar o 400)
const ONE_BY_ONE_JPG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAAaABoBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCkA//Z";

export async function GET() {
  const buf = Buffer.from(ONE_BY_ONE_JPG_BASE64, "base64");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      // Não cachear agressivo pra não ficar preso caso você queira mudar depois
      "Cache-Control": "no-store",
    },
  });
}