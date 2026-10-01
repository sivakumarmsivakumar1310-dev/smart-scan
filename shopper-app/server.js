/**
 * SmartScan Shopper Backend API Server
 * Built with Node.js & Express.
 * Reads configurations securely from .env
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const STORE_ID = process.env.STORE_ID || 'STORE_104';
const STORE_NAME = process.env.STORE_NAME || 'Smart Supermarket • Central Hub';
const JWT_SECRET = process.env.JWT_SECRET || 'smartscan_shopper_secure_jwt_token_2026';
const UPI_MERCHANT_ID = process.env.UPI_MERCHANT_ID || 'smartscan.store104@icici';

// Configured Demo Shopper Credentials from .env
const DEFAULT_SHOPPER_PHONE = process.env.DEFAULT_SHOPPER_PHONE || '9876543210';
const DEFAULT_SHOPPER_PASSWORD = process.env.DEFAULT_SHOPPER_PASSWORD || 'shopper123';
const DEFAULT_SHOPPER_NAME = process.env.DEFAULT_SHOPPER_NAME || 'Alex Sharma';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (Shopper PWA)
app.use(express.static(path.join(__dirname, '.')));

// In-Memory Data Store
let productsDB = [];
let ordersDB = [];
let activeCartsDB = new Map();
let registeredUsersDB = [
  {
    phone: DEFAULT_SHOPPER_PHONE,
    password: DEFAULT_SHOPPER_PASSWORD,
    fullName: DEFAULT_SHOPPER_NAME,
    createdAt: new Date().toISOString()
  }
];

// Load sample dataset
try {
  const sampleDataPath = path.join(__dirname, 'data', 'sample_products.json');
  if (fs.existsSync(sampleDataPath)) {
    const rawData = fs.readFileSync(sampleDataPath, 'utf8');
    productsDB = JSON.parse(rawData);
    console.log(`[Shopper API] Loaded ${productsDB.length} sample products from catalog.`);
  }
} catch (err) {
  console.error('[Shopper API] Error loading sample products:', err.message);
}

// Parse promo codes from .env
function getPromoCodes() {
  const rawCodes = process.env.VALID_PROMO_CODES || 'SMART10:10,SAVE50:50,WELCOME20:20';
  const promoMap = {};
  rawCodes.split(',').forEach(entry => {
    const [code, val] = entry.split(':');
    if (code && val) {
      promoMap[code.trim().toUpperCase()] = Number(val.trim());
    }
  });
  return promoMap;
}

// Generate tamper-proof exit QR token
function generateExitVerificationToken(orderNumber, totalAmount, customerPhone) {
  const timestamp = Date.now();
  const rawPayload = `${orderNumber}|${totalAmount}|${customerPhone}|${timestamp}|${JWT_SECRET}`;
  const signature = crypto.createHash('sha256').update(rawPayload).digest('hex').substring(0, 32);
  return {
    token: `SMARTSCAN-EXIT-${orderNumber}-${signature}`,
    generatedAt: new Date(timestamp).toISOString()
  };
}

// ==========================================
// 1. SHOPPER AUTHENTICATION ENDPOINTS (.env supported)
// ==========================================

// Shopper Login with Mobile/User ID and Password
app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, error: 'Phone number and password are required.' });
  }

  // Check against .env or registered users
  const user = registeredUsersDB.find(u => u.phone === phone.trim() && u.password === password);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: `Invalid credentials. For demo, use Phone: ${DEFAULT_SHOPPER_PHONE} and Password: ${DEFAULT_SHOPPER_PASSWORD}`
    });
  }

  const sessionToken = `SHOPPER-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  res.json({
    success: true,
    message: 'Logged in successfully.',
    data: {
      sessionToken,
      user: {
        fullName: user.fullName,
        phone: user.phone,
        role: 'shopper',
        storeId: STORE_ID,
        storeName: STORE_NAME
      }
    }
  });
});

// Shopper Registration
app.post('/api/auth/register', (req, res) => {
  const { fullName, phone, password } = req.body;

  if (!fullName || !phone || !password) {
    return res.status(400).json({ success: false, error: 'Full name, phone, and password are required.' });
  }

  const existing = registeredUsersDB.find(u => u.phone === phone.trim());
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this phone number already exists. Please login.' });
  }

  const newUser = {
    fullName: fullName.trim(),
    phone: phone.trim(),
    password: password,
    createdAt: new Date().toISOString()
  };
  registeredUsersDB.push(newUser);

  const sessionToken = `SHOPPER-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: {
      sessionToken,
      user: {
        fullName: newUser.fullName,
        phone: newUser.phone,
        role: 'shopper',
        storeId: STORE_ID,
        storeName: STORE_NAME
      }
    }
  });
});

// Quick Guest Onboarding
app.post('/api/auth/guest-session', (req, res) => {
  const { fullName, phoneNumber } = req.body;
  const phone = phoneNumber || DEFAULT_SHOPPER_PHONE;
  const name = fullName || 'Guest Shopper';

  const sessionToken = `GUEST-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  res.json({
    success: true,
    data: {
      sessionToken,
      user: {
        fullName: name,
        phone: phone,
        role: 'shopper',
        storeId: STORE_ID,
        storeName: STORE_NAME
      }
    }
  });
});

// Get Config & Store Info
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      storeId: STORE_ID,
      storeName: STORE_NAME,
      upiMerchantId: UPI_MERCHANT_ID,
      demoCredentials: {
        phone: DEFAULT_SHOPPER_PHONE,
        password: DEFAULT_SHOPPER_PASSWORD,
        name: DEFAULT_SHOPPER_NAME
      }
    }
  });
});

// ==========================================
// 2. PRODUCT CATALOG & SCANNING API
// ==========================================

// Get all products / search
app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
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
      error: `Barcode '${barcode}' was not found in store catalog.`,
      barcode
    });
  }

  res.json({
    success: true,
    data: product
  });
});

// Validate Promo Code
app.post('/api/coupons/validate', (req, res) => {
  const { code, subtotal = 0 } = req.body;
  if (!code) {
    return res.status(400).json({ success: false, error: 'Coupon code is required.' });
  }

  const promoMap = getPromoCodes();
  const normalized = code.trim().toUpperCase();

  if (promoMap[normalized] !== undefined) {
    const discount = promoMap[normalized];
    return res.json({
      success: true,
      valid: true,
      discountAmount: discount,
      message: `Coupon '${normalized}' applied! You saved ₹${discount}.`
    });
  }

  res.status(400).json({
    success: false,
    valid: false,
    error: `Invalid coupon code. Try SMART10 or SAVE50.`
  });
});

// ==========================================
// 3. CART & CHECKOUT API
// ==========================================

// Sync active cart
app.post('/api/cart/sync', (req, res) => {
  const { sessionToken, customerName, customerPhone, items = [] } = req.body;
  if (!sessionToken) {
    return res.status(400).json({ success: false, error: 'Session token is required.' });
  }

  activeCartsDB.set(sessionToken, {
    sessionToken,
    customerName: customerName || DEFAULT_SHOPPER_NAME,
    customerPhone: customerPhone || DEFAULT_SHOPPER_PHONE,
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
    customerName = DEFAULT_SHOPPER_NAME,
    customerPhone = DEFAULT_SHOPPER_PHONE,
    cartItems = [],
    paymentMethod = 'upi',
    appliedDiscount = 0,
    sessionToken
  } = req.body;

  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ success: false, error: 'Cannot checkout with an empty cart.' });
  }

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
    storeId: STORE_ID,
    storeName: STORE_NAME,
    storeAddress: 'Smart Supermarket, Level 1, Retail Hub, Connaught Place, New Delhi',
    storeGstin: '07AABCS1429B1Z8',
    storeFssai: '10019011000123',
    customerName: customerName || DEFAULT_SHOPPER_NAME,
    customerPhone: customerPhone || DEFAULT_SHOPPER_PHONE,
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
    status: 'paid',
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

  if (sessionToken) {
    activeCartsDB.delete(sessionToken);
  }

  res.status(201).json({
    success: true,
    message: 'Payment completed successfully. Digital tax invoice and Exit QR pass generated.',
    data: newOrder
  });
});

// Get all orders (with optional customer phone filter)
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

// Get orders for a specific customer phone
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

// ==========================================
// 4. REAL-TIME SMS & WHATSAPP BILL NOTIFICATIONS
// ==========================================
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
  const storeName = order ? order.storeName : STORE_NAME;

  const now = new Date();
  const timeFormatted = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateFormatted = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // Generate realistic SMS & WhatsApp bill payload
  const whatsappMessage = `*⚡ ${storeName}*\n\n` +
    `Hello *${customerName}*,\n` +
    `Your digital tax invoice for *Order #${orderNumber}* has been generated successfully.\n\n` +
    `🛒 *Items Billed:* ${itemCount} items\n` +
    `💰 *Grand Total Paid:* ₹${totalAmount}\n` +
    `🎉 *Total Savings:* ₹${totalSavings}\n` +
    `⏱️ *Time:* ${dateFormatted} at ${timeFormatted}\n\n` +
    `🛡️ *Exit Gate Pass Token:*\n` +
    `\`${exitToken}\`\n\n` +
    `🔗 *View Live Bill & QR Exit Pass:* http://localhost:${PORT}/?order=${orderNumber}\n\n` +
    `_Thank you for shopping with SmartScan Self-Checkout!_`;

  const smsMessage = `[${storeName}] Order #${orderNumber} Confirmed! Paid ₹${totalAmount} for ${itemCount} items (Saved ₹${totalSavings}). Exit Pass: ${exitToken}. View invoice: http://localhost:${PORT}/?order=${orderNumber}`;

  const messageId = `MSG_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  res.json({
    success: true,
    message: `Digital bill alert successfully dispatched via ${channel.toUpperCase()} to +91 ${targetPhone}.`,
    data: {
      messageId,
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

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🛒 SmartScan Shopper Mobile Web App running on port ${PORT}`);
    console.log(`📱 Shopper App URL: http://localhost:${PORT}`);
    console.log(`🔑 Demo Login -> Phone: ${DEFAULT_SHOPPER_PHONE}, Password: ${DEFAULT_SHOPPER_PASSWORD}`);
    console.log(`====================================================`);
  });
}

module.exports = app;
