import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/uploads/:id — yuklangan rasmni qaytaradi.
 *
 * Bu manzil ochiq: mehmonning brauzeri menyudagi rasmni ko'rsatishi uchun
 * hech qanday sessiya talab qilinmaydi.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const upload = db.getUpload(id);

  if (!upload) {
    return NextResponse.json({ error: 'Rasm topilmadi.' }, { status: 404 });
  }

  const { record, bytes } = upload;
  const body = new Uint8Array(bytes);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': record.content_type,
      'Content-Length': String(record.size),
      // Baytlar hech qachon o'zgarmaydi (id — kontentga bog'langan yozuv),
      // shuning uchun uzoq muddatli keshlash xavfsiz.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
