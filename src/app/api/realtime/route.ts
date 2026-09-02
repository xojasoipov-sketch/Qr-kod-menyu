import { NextRequest } from 'next/server';
import { eventBus, RealtimePayload } from '@/lib/realtime/event-bus';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id');
  const branchId = searchParams.get('branch_id');
  const orderId = searchParams.get('order_id');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial keepalive
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`));

      const unsubscribe = eventBus.subscribe((payload: RealtimePayload) => {
        // Filter events if needed
        if (restaurantId && payload.restaurant_id !== restaurantId) return;
        if (branchId && payload.branch_id && payload.branch_id !== branchId) return;
        if (orderId && payload.orderId && payload.orderId !== orderId && payload.order?.id !== orderId) return;

        const data = `data: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(data));
      });

      // Keep connection open with heartbeat ping every 15s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
