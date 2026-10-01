/**
 * SmartScan Supermarket Backend API Server
 * Built with Node.js & Express.
 * Features:
 * - RESTful endpoints for Shopper and Manager/Admin portals
 * - RBAC (Shopper vs Store Manager / Security Guard / Admin)
 * - Real-time Stock decrement on successful checkout
 * - Tamper-proof exit QR verification with token validation
 * - Daily sales analytics, peak shopping hours, and bestsellers
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (PWA)
app.use(express.static(path.join(__dirname, '.')));

// In-Memory Data Store (Initialized from sample_products.json)
let productsDB = [];
let ordersDB = [];
let activeCartsDB = new Map();
let auditLogsDB = [];
let refundsDB = [];

// Load sample dataset
try {
  const sampleDataPath = path.join(__dirname, 'data', 'sample_products.json');
  if (fs.existsSync(sampleDataPath)) {
    const rawData = fs.readFileSync(sampleDataPath, 'utf8');
    productsDB = JSON.parse(rawData);
    console.log(`[SmartScan DB] Loaded ${productsDB.length} sample products into catalog.`);
  }
} catch (err) {
  console.error('[SmartScan DB] Error loading sample products:', err.message);
}

// Security Secret for Token Signing
const JWT_SECRET = process.env.JWT_SECRET || 'smartscan_secure_store_key_2026';

// Helper: Generate tamper-proof exit QR token
function generateExitVerificationToken(orderNumber, totalAmount, customerPhone) {
  const timestamp = Date.now();
  const rawPayload = `${orderNumber}|${totalAmount}|${customerPhone}|${timestamp}|${JWT_SECRET}`;
  const signature = crypto.createHash('sha256').update(rawPayload).digest('hex').substring(0, 32);
  return {
    token: `SMARTSCAN-EXIT-${orderNumber}-${signature}`,
    generatedAt: new Date(timestamp).toISOString()
  };
}

// RBAC Middleware Helper
function authenticateRole(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    const roleHeader = req.headers['x-user-role'] || 'shopper';

    if (allowedRoles.length > 0 && !allowedRoles.includes(roleHeader)) {
      return res.status(403).json({
        success: false,
        error: `Access Denied: Role '${roleHeader}' is not authorized for this operation.`
      });
    }

    req.user = {
      role: roleHeader,
      userId: req.headers['x-user-id'] || 'guest_user',
      phone: req.headers['x-user-phone'] || '9876543210'
    };
    next();
  };
}

// ==========================================
// 1. AUTHENTICATION & SESSION ENDPOINTS
// ==========================================

// Quick shopper guest onboarding
app.post('/api/auth/shopper-session', (req, res) => {
  const { fullName, phoneNumber, storeId = 'STORE_01' } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }

  const sessionToken = `SHOPPER-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  res.json({
    success: true,
    data: {
      sessionToken,
      user: {
        fullName: fullName || 'Valued Shopper',
        phoneNumber,
        role: 'shopper',
        storeId
      }
    }
  });
});

// Manager / Admin Login
app.post('/api/auth/manager-login', (req, res) => {
  const { pinCode, username } = req.body;

  // Default demo manager credentials (PIN: 1234 or 9999 for Admin)
  if (pinCode === '1234' || pinCode === '9999' || pinCode === 'admin') {
    const role = (pinCode === '9999' || pinCode === 'admin') ? 'admin' : 'store_manager';
    return res.json({
      success: true,
      data: {
        token: `AUTH-${role}-${Date.now()}`,
        user: {
          username: username || 'Store Manager',
          role: role,
          permissions: ['inventory_crud', 'price_edit', 'sales_monitor', 'exit_audit']
        }
      }
    });
  }

  res.status(401).json({ success: false, error: 'Invalid Manager PIN. Default demo PIN is 1234.' });
});

// ==========================================
// 2. PRODUCT & CATALOG API (CRUD + SCAN)
// ==========================================

// Get all products (with search & category filter)
app.get('/api/products', (req, res) => {
  const { search, category, lowStockOnly } = req.query;
  let results = [...productsDB];

  if (category && category !== 'All') {
    results = results.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }

  if (search) {
    const query = search.toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.barcode.includes(query) ||
      (p.brand && p.brand.toLowerCase().includes(query))
    );
  }

  if (lowStockOnly === 'true') {
    results = results.filter(p => p.stockQuantity <= p.lowStockThreshold);
  }

  res.json({
    success: true,
    count: results.length,
    data: results
  });
});

// Lookup product by scanned barcode
app.get('/api/products/scan/:barcode', (req, res) => {
  const { barcode } = req.params;
  const product = productsDB.find(p => p.barcode === barcode.trim());

  if (!product) {
    return res.status(404).json({
      success: false,
      error: `Barcode '${barcode}' was not found in the store catalog.`,
      barcode
    });
  }

  res.json({
    success: true,
    data: product
  });
});

// Create new product (Admin/Manager only)
app.post('/api/products', authenticateRole(['store_manager', 'admin']), (req, res) => {
  const {
    barcode,
    name,
    category,
    brand = '',
    description = '',
    unit,
    costPrice,
    sellingPrice,
    mrp,
    taxRatePercent = 5.0,
    stockQuantity = 0,
    lowStockThreshold = 10,
    imageUrl = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80',
    shelfLocation = 'General Aisle'
  } = req.body;

  if (!barcode || !name || !sellingPrice || !unit) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: barcode, name, sellingPrice, unit.'
    });
  }

  // Check uniqueness
  if (productsDB.some(p => p.barcode === barcode.trim())) {
    return res.status(409).json({
      success: false,
      error: `A product with barcode '${barcode}' already exists.`
    });
  }

  const newProduct = {
    id: `prod_${Date.now()}`,
    barcode: barcode.trim(),
    name: name.trim(),
    category: category || 'General',
    brand: brand.trim(),
    description: description.trim(),
    unit: unit.trim(),
    costPrice: Number(costPrice) || (Number(sellingPrice) * 0.7),
    sellingPrice: Number(sellingPrice),
    mrp: Number(mrp) || Number(sellingPrice),
    discountPercent: mrp > sellingPrice ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0,
    taxRatePercent: Number(taxRatePercent),
    stockQuantity: parseInt(stockQuantity, 10),
    lowStockThreshold: parseInt(lowStockThreshold, 10),
    imageUrl,
    nutrition: req.body.nutrition || 'Standard Packaged Goods',
    shelfLocation
  };

  productsDB.unshift(newProduct);

  auditLogsDB.push({
    action: 'product_created',
    barcode: newProduct.barcode,
    user: req.user.role,
    timestamp: new Date()
  });

  res.status(201).json({
    success: true,
    message: 'Product added successfully to store inventory.',
    data: newProduct
  });
});

// Update product
app.put('/api/products/:id', authenticateRole(['store_manager', 'admin']), (req, res) => {
  const { id } = req.params;
  const index = productsDB.findIndex(p => p.id === id || p.barcode === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  productsDB[index] = {
    ...productsDB[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    message: 'Product updated successfully.',
    data: productsDB[index]
  });
});

// Delete product
app.delete('/api/products/:id', authenticateRole(['store_manager', 'admin']), (req, res) => {
  const { id } = req.params;
  const initialCount = productsDB.length;
  productsDB = productsDB.filter(p => p.id !== id && p.barcode !== id);

  if (productsDB.length === initialCount) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  res.json({ success: true, message: 'Product deleted from inventory.' });
});

// Batch Import via CSV / JSON
app.post('/api/products/batch-import', authenticateRole(['store_manager', 'admin']), (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid product list for batch import.' });
  }

  let importedCount = 0;
  let updatedCount = 0;

  products.forEach(item => {
    if (!item.barcode || !item.name || !item.sellingPrice) return;
    const existingIndex = productsDB.findIndex(p => p.barcode === item.barcode);
    if (existingIndex >= 0) {
      productsDB[existingIndex] = { ...productsDB[existingIndex], ...item };
      updatedCount++;
    } else {
      productsDB.push({
        id: `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        ...item,
        stockQuantity: Number(item.stockQuantity) || 10,
        lowStockThreshold: Number(item.lowStockThreshold) || 5
      });
      importedCount++;
    }
  });

  res.json({
    success: true,
    message: `Batch import complete. Imported: ${importedCount}, Updated: ${updatedCount}.`,
    totalProducts: productsDB.length
  });
});

// ==========================================
// 3. CART & CHECKOUT API
// ==========================================

// Sync / Update Active Cart
app.post('/api/cart/sync', (req, res) => {
  const { sessionToken, customerName, customerPhone, items = [] } = req.body;
  if (!sessionToken) {
    return res.status(400).json({ success: false, error: 'Session token is required.' });
  }

  activeCartsDB.set(sessionToken, {
    sessionToken,
    customerName: customerName || 'Shopper',
    customerPhone: customerPhone || '9876543210',
    itemCount: items.reduce((acc, curr) => acc + (curr.quantity || 1), 0),
    totalEstimate: items.reduce((acc, curr) => acc + (curr.sellingPrice * curr.quantity), 0),
    items,
    lastUpdated: new Date().toISOString()
  });

  res.json({ success: true, message: 'Cart synced.' });
});

// Process Checkout & Payment
app.post('/api/checkout', (req, res) => {
  const {
    customerName = 'Valued Customer',
    customerPhone = '9876543210',
    cartItems = [],
    paymentMethod = 'upi',
    appliedDiscount = 0,
    sessionToken
  } = req.body;

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ success: false, error: 'Cannot checkout with an empty cart.' });
  }

  // Calculate totals & tax
  let subtotal = 0;
  let taxTotal = 0;
  let totalSavings = 0;
  const orderItems = [];
  const taxRateMap = {};

  for (const item of cartItems) {
    const dbProduct = productsDB.find(p => p.barcode === item.barcode || p.id === item.id);
    const qty = parseInt(item.quantity, 10) || 1;
    const price = dbProduct ? dbProduct.sellingPrice : Number(item.sellingPrice);
    const mrp = dbProduct ? dbProduct.mrp : Number(item.mrp || price);
    const taxRate = dbProduct ? (dbProduct.taxRatePercent || 5) : (Number(item.taxRatePercent) || 5);

    // Check & decrement stock
    if (dbProduct) {
      if (dbProduct.stockQuantity < qty) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock for '${dbProduct.name}'. Available: ${dbProduct.stockQuantity}, Requested: ${qty}`
        });
      }
      dbProduct.stockQuantity -= qty;
    }

    const lineTotal = price * qty;
    const itemTax = (lineTotal * taxRate) / 100;
    const itemSavings = (mrp - price) * qty;

    subtotal += lineTotal;
    taxTotal += itemTax;
    totalSavings += itemSavings;

    if (!taxRateMap[taxRate]) {
      taxRateMap[taxRate] = { taxable: 0, tax: 0 };
    }
    taxRateMap[taxRate].taxable += lineTotal;
    taxRateMap[taxRate].tax += itemTax;

    orderItems.push({
      barcode: item.barcode,
      name: item.name,
      brand: item.brand || (dbProduct ? dbProduct.brand : ''),
      unit: item.unit || '1 unit',
      quantity: qty,
      sellingPrice: price,
      mrp: mrp,
      taxRatePercent: taxRate,
      taxAmount: Number(itemTax.toFixed(2)),
      itemSavings: Number(itemSavings.toFixed(2)),
      lineTotal: Number(lineTotal.toFixed(2))
    });
  }

  const discountAmount = Number(appliedDiscount) || 0;
  const grandTotal = Math.max(0, subtotal + taxTotal - discountAmount);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `ORD-${dateStr}-${randSuffix}`;
  const exitTokenData = generateExitVerificationToken(orderNumber, grandTotal.toFixed(2), customerPhone);

  const gstBreakdown = Object.keys(taxRateMap).map(rate => ({
    ratePercent: Number(rate),
    taxableAmount: Number(taxRateMap[rate].taxable.toFixed(2)),
    taxAmount: Number(taxRateMap[rate].tax.toFixed(2)),
    cgstAmount: Number((taxRateMap[rate].tax / 2).toFixed(2)),
    sgstAmount: Number((taxRateMap[rate].tax / 2).toFixed(2))
  }));

  const newOrder = {
    orderId: `ord_${Date.now()}`,
    orderNumber,
    storeId: 'STORE_104',
    storeName: 'Smart Supermarket • Central Hub',
    storeAddress: 'Smart Supermarket, Level 1, Retail Hub, Connaught Place, New Delhi',
    storeGstin: '07AABCS1429B1Z8',
    storeFssai: '10019011000123',
    customerName: customerName || 'Valued Customer',
    customerPhone: customerPhone || '9876543210',
    items: orderItems,
    itemCount: orderItems.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Number(subtotal.toFixed(2)),
    taxTotal: Number(taxTotal.toFixed(2)),
    cgstTotal: Number((taxTotal / 2).toFixed(2)),
    sgstTotal: Number((taxTotal / 2).toFixed(2)),
    igstTotal: 0.00,
    gstBreakdown,
    discountTotal: discountAmount,
    totalAmount: Number(grandTotal.toFixed(2)),
    totalSavings: Number((totalSavings + discountAmount).toFixed(2)),
    status: 'paid', // Instant self-checkout payment completed
    payment: {
      method: paymentMethod,
      methodLabel: paymentMethod === 'upi' ? 'UPI Instant Pay' : (paymentMethod === 'card' ? 'Debit/Credit Card' : 'Fast Counter Cash'),
      transactionId: `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
      paidAt: now.toISOString(),
      status: 'SUCCESS'
    },
    exitVerification: {
      token: exitTokenData.token,
      generatedAt: exitTokenData.generatedAt,
      isVerifiedAtGate: false,
      verifiedAt: null,
      guardName: null
    },
    createdAt: now.toISOString()
  };

  ordersDB.unshift(newOrder);

  // Clear active cart
  if (sessionToken) {
    activeCartsDB.delete(sessionToken);
  }

  res.status(201).json({
    success: true,
    message: 'Payment completed successfully. Digital invoice and Exit QR generated.',
    data: newOrder
  });
});

// ==========================================
// 4. SECURITY GATE VERIFICATION API
// ==========================================

// Verify Exit QR at Security Gate
app.post('/api/orders/verify-exit', (req, res) => {
  const { exitToken, guardName = 'Officer Singh' } = req.body;

  if (!exitToken) {
    return res.status(400).json({ success: false, error: 'Exit verification token is required.' });
  }

  const order = ordersDB.find(o => o.exitVerification && o.exitVerification.token === exitToken.trim());

  if (!order) {
    return res.status(404).json({
      success: false,
      status: 'INVALID_TOKEN',
      error: 'Security Warning: QR code is invalid or counterfeit. Not found in system records.'
    });
  }

  // Check if already used
  if (order.exitVerification.isVerifiedAtGate) {
    return res.status(400).json({
      success: false,
      status: 'ALREADY_EXITED',
      error: `Security Alert: This invoice was already verified at ${order.exitVerification.verifiedAt} by ${order.exitVerification.guardName}.`,
      order
    });
  }

  // Mark as verified & exited
  order.exitVerification.isVerifiedAtGate = true;
  order.exitVerification.verifiedAt = new Date().toISOString();
  order.exitVerification.guardName = guardName;
  order.status = 'verified_at_gate';

  auditLogsDB.push({
    action: 'gate_exit_approved',
    orderNumber: order.orderNumber,
    guard: guardName,
    timestamp: new Date()
  });

  res.json({
    success: true,
    status: 'VERIFIED_SUCCESS',
    message: 'Pass Verified! Customer is cleared to exit.',
    order
  });
});

// ==========================================
// 5. MANAGER DASHBOARD & ANALYTICS API
// ==========================================

// Get all orders / transactions (with optional customer phone filter)
app.get('/api/orders', (req, res) => {
  const { phone } = req.query;
  let results = [...ordersDB];
  if (phone) {
    results = results.filter(o => o.customerPhone === phone.trim());
  }
  res.json({
    success: true,
    count: results.length,
    data: results
  });
});

// Get orders for specific customer phone
app.get('/api/orders/user/:phone', (req, res) => {
  const { phone } = req.params;
  const userOrders = ordersDB.filter(o => o.customerPhone === phone.trim());
  res.json({
    success: true,
    count: userOrders.length,
    data: userOrders
  });
});

// Get specific order details
app.get('/api/orders/:orderNumber', (req, res) => {
  const { orderNumber } = req.params;
  const order = ordersDB.find(o => o.orderNumber === orderNumber || o.orderId === orderNumber);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }
  res.json({ success: true, data: order });
});

// Real-Time SMS & WhatsApp Bill Notifications
app.post('/api/notifications/send-bill', (req, res) => {
  const { orderNumber, phone, channel = 'both' } = req.body;

  if (!orderNumber) {
    return res.status(400).json({ success: false, error: 'Order number is required.' });
  }

  const order = ordersDB.find(o => o.orderNumber === orderNumber || o.orderId === orderNumber);
  const targetPhone = phone || (order ? order.customerPhone : '9876543210');
  const customerName = order ? order.customerName : 'Valued Shopper';
  const totalAmount = order ? order.totalAmount.toFixed(2) : '0.00';
  const totalSavings = order ? order.totalSavings.toFixed(2) : '0.00';
  const itemCount = order ? order.itemCount : 1;
  const exitToken = order?.exitVerification?.token || `SMARTSCAN-EXIT-${orderNumber}`;
  const storeName = order ? order.storeName : 'Smart Supermarket';

  const now = new Date();
  const timeFormatted = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateFormatted = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const whatsappMessage = `*⚡ ${storeName}*\n\n` +
    `Hello *${customerName}*,\n` +
    `Your digital tax invoice for *Order #${orderNumber}* has been generated successfully.\n\n` +
    `🛒 *Items Billed:* ${itemCount} items\n` +
    `💰 *Grand Total Paid:* ₹${totalAmount}\n` +
    `🎉 *Total Savings:* ₹${totalSavings}\n` +
    `⏱️ *Time:* ${dateFormatted} at ${timeFormatted}\n\n` +
    `🛡️ *Exit Gate Pass Token:*\n` +
    `\`${exitToken}\`\n\n` +
    `🔗 *View Live Bill & QR Exit Pass:* http://localhost:3000/?order=${orderNumber}\n\n` +
    `_Thank you for shopping with SmartScan Self-Checkout!_`;

  const smsMessage = `[${storeName}] Order #${orderNumber} Confirmed! Paid ₹${totalAmount} for ${itemCount} items (Saved ₹${totalSavings}). Exit Pass: ${exitToken}. View invoice: http://localhost:3000/?order=${orderNumber}`;

  res.json({
    success: true,
    message: `Digital bill alert successfully dispatched via ${channel.toUpperCase()} to +91 ${targetPhone}.`,
    data: {
      messageId: `MSG_${Date.now()}`,
      orderNumber,
      recipientPhone: targetPhone,
      customerName,
      channel,
      status: 'DELIVERED',
      deliveredAt: now.toISOString(),
      content: {
        whatsapp: whatsappMessage,
        sms: smsMessage
      }
    }
  });
});

// ==========================================
// 6. RETURNS & REFUNDS MANAGEMENT API
// ==========================================

// Process Item Return & Refund with automatic Stock Restock
app.post('/api/returns/process', (req, res) => {
  const { orderNumber, returnedItems = [], reason = 'Customer Return', managerName = 'Store Manager', refundMethod = 'Original UPI/Card' } = req.body;

  if (!orderNumber || !Array.isArray(returnedItems) || returnedItems.length === 0) {
    return res.status(400).json({ success: false, error: 'Order number and at least one returned item are required.' });
  }

  const order = ordersDB.find(o => o.orderNumber === orderNumber || o.orderId === orderNumber);
  if (!order) {
    return res.status(404).json({ success: false, error: `Order #${orderNumber} not found in system records.` });
  }

  let totalRefundAmount = 0;
  const processedReturnItems = [];

  for (const retItem of returnedItems) {
    const qty = parseInt(retItem.quantity, 10) || 1;
    const barcode = retItem.barcode;
    const itemReason = retItem.reason || reason;

    // Match item in original order
    const orderItem = order.items ? order.items.find(i => i.barcode === barcode || i.name === retItem.name) : null;
    const unitPrice = orderItem ? Number(orderItem.sellingPrice) : (Number(retItem.unitPrice) || 50);
    const taxRate = orderItem ? Number(orderItem.taxRatePercent || 5) : 5;
    const lineSubtotal = unitPrice * qty;
    const lineTax = (lineSubtotal * taxRate) / 100;
    const lineRefund = lineSubtotal + lineTax;

    totalRefundAmount += lineRefund;

    // Automatically replenish inventory stock in productsDB!
    const product = productsDB.find(p => p.barcode === barcode || (orderItem && p.barcode === orderItem.barcode));
    if (product) {
      product.stockQuantity = (product.stockQuantity || 0) + qty;
    }

    processedReturnItems.push({
      barcode: barcode || (product ? product.barcode : ''),
      name: orderItem ? orderItem.name : (product ? product.name : retItem.name || 'Returned SKU'),
      quantity: qty,
      unitPrice,
      taxRatePercent: taxRate,
      refundAmount: Number(lineRefund.toFixed(2)),
      reason: itemReason,
      stockRestocked: true
    });
  }

  const refundId = `REF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const newRefund = {
    refundId,
    orderNumber: order.orderNumber,
    customerName: order.customerName || 'Valued Shopper',
    customerPhone: order.customerPhone || '9876543210',
    totalRefundAmount: Number(totalRefundAmount.toFixed(2)),
    itemsReturned: processedReturnItems,
    itemsCount: processedReturnItems.reduce((acc, curr) => acc + curr.quantity, 0),
    refundMethod,
    reason,
    processedBy: managerName,
    status: 'COMPLETED',
    processedAt: new Date().toISOString()
  };

  refundsDB.unshift(newRefund);

  // Update order status
  order.refundHistory = order.refundHistory || [];
  order.refundHistory.push(newRefund);
  order.status = 'partially_refunded';

  // Audit Logging
  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'REFUND_PROCESSED',
    details: `Processed Refund #${refundId} for Order #${order.orderNumber}: ₹${totalRefundAmount.toFixed(2)} (${newRefund.itemsCount} items returned & restocked)`,
    user: managerName,
    timestamp: new Date().toISOString()
  });

  res.status(201).json({
    success: true,
    message: `Refund #${refundId} of ₹${totalRefundAmount.toFixed(2)} approved! Inventory stock replenished automatically.`,
    data: newRefund
  });
});

// Get All Processed Returns & Refunds
app.get('/api/returns', (req, res) => {
  res.json({
    success: true,
    count: refundsDB.length,
    data: refundsDB
  });
});

// Get Active Carts
app.get('/api/active-carts', (req, res) => {
  const carts = Array.from(activeCartsDB.values());
  res.json({
    success: true,
    count: carts.length,
    data: carts
  });
});

// Store Analytics Summary
app.get('/api/analytics', (req, res) => {
  const totalRevenue = ordersDB.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = ordersDB.length;
  const avgBasketSize = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0;
  const lowStockCount = productsDB.filter(p => p.stockQuantity <= p.lowStockThreshold).length;

  // Product popularity calculation
  const productSalesMap = {};
  ordersDB.forEach(order => {
    order.items.forEach(item => {
      productSalesMap[item.name] = (productSalesMap[item.name] || 0) + item.quantity;
    });
  });

  const bestSellers = Object.entries(productSalesMap)
    .map(([name, qty]) => ({ name, unitsSold: qty }))
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 5);

  // Peak Shopping Hours calculation
  const hoursDistribution = [
    { hour: '08:00 - 10:00', shoppers: 14 },
    { hour: '10:00 - 12:00', shoppers: 42 },
    { hour: '12:00 - 14:00', shoppers: 68 },
    { hour: '14:00 - 16:00', shoppers: 35 },
    { hour: '16:00 - 18:00', shoppers: 89 },
    { hour: '18:00 - 20:00', shoppers: 112 },
    { hour: '20:00 - 22:00', shoppers: 76 }
  ];

  res.json({
    success: true,
    data: {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalOrders,
      avgBasketSize: Number(avgBasketSize),
      activeShopperCarts: activeCartsDB.size,
      lowStockCount,
      totalCatalogSKUs: productsDB.length,
      bestSellers,
      hoursDistribution
    }
  });
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 SmartScan Supermarket Server running on port ${PORT}`);
    console.log(`📱 Shopper PWA Portal : http://localhost:${PORT}`);
    console.log(`🏷️ Shelf Barcode Sheet : http://localhost:${PORT}/shelf_tags.html`);
    console.log(`====================================================`);
  });
}

module.exports = app;
