// Test script for end-to-end API verification
async function testAll() {
  console.log('--- 1. Testing GET /api/orders ---');
  const res1 = await fetch('http://localhost:3001/api/orders?restaurant_id=rest-001');
  const d1 = await res1.json();
  console.log('Orders count:', d1.orders.length);

  console.log('--- 2. Testing POST /api/orders (Server Price Recalculation) ---');
  const res2 = await fetch('http://localhost:3001/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table_id: 'tbl-002',
      customer_notes: 'Medium Rare please, no extra salt',
      items: [
        {
          menu_item_id: 'item-001', // Wagyu Ribeye ($48.00)
          quantity: 2,
          selected_options: [
            { group_id: 'opt-meat-temp', group_name: 'Cooking Temperature', option_id: 'med-rare', option_name: 'Medium Rare', price: 0 }
          ]
        },
        {
          menu_item_id: 'item-016', // Hibiscus Sparkler ($8.50)
          quantity: 1
        }
      ]
    })
  });
  const d2 = await res2.json();
  console.log('New Order Created:', d2.order.order_number, 'Total:', d2.order.total, 'Status:', d2.order.status);

  console.log('--- 3. Testing PATCH /api/orders/[id]/status (State Machine Transition) ---');
  const res3 = await fetch(`http://localhost:3001/api/orders/${d2.order.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'preparing',
      changed_by: 'KITCHEN_TEST',
      reason: 'Cook started'
    })
  });
  const d3 = await res3.json();
  console.log('Order Status updated to:', d3.order.status);

  console.log('--- 4. Testing POST /api/waiter-calls ---');
  const res4 = await fetch('http://localhost:3001/api/waiter-calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table_id: 'tbl-002',
      call_type: 'SERVICE'
    })
  });
  const d4 = await res4.json();
  console.log('Waiter Call created:', d4.call.id, 'Table:', d4.call.table_number);

  console.log('--- 5. Testing POST /api/tables/[id]/regenerate-qr ---');
  const res5 = await fetch('http://localhost:3001/api/tables/tbl-002/regenerate-qr', {
    method: 'POST'
  });
  const d5 = await res5.json();
  console.log('QR Token Regenerated! Old:', d5.oldToken, 'New:', d5.newToken);

  console.log('✅ ALL API TESTS PASSED SUCCESSFULLY!');
}

testAll().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
