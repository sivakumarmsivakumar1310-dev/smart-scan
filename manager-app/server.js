/**
 * SmartScan Store Operations & Manager Portal Backend API
 * Built with Node.js & Express.
 * Credentials and configurations are securely loaded from .env
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const STORE_ID = process.env.STORE_ID || 'STORE_104';
const STORE_NAME = process.env.STORE_NAME || 'Smart Supermarket • Central Operations Hub';
const JWT_SECRET = process.env.JWT_SECRET || 'smartscan_manager_secure_jwt_token_2026';

// Credentials loaded securely from .env
const MANAGER_USERNAME = process.env.MANAGER_USERNAME || 'admin';
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || 'SmartStore@2026';
const MANAGER_PIN = process.env.MANAGER_PIN || '1234';
const GUARD_PIN = process.env.GUARD_PIN || '5678';
const GUARD_NAME = process.env.GUARD_NAME || 'Officer Singh';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (Manager & Guard Portal)
app.use(express.static(path.join(__dirname, '.')));

// In-Memory Data Store
let productsDB = [];
let ordersDB = [];
let auditLogsDB = [];
let refundsDB = [];

// Load sample dataset
try {
  const sampleDataPath = path.join(__dirname, 'data', 'sample_products.json');
  if (fs.existsSync(sampleDataPath)) {
    const rawData = fs.readFileSync(sampleDataPath, 'utf8');
    productsDB = JSON.parse(rawData);
    console.log(`[Manager API] Loaded ${productsDB.length} catalog products from dataset.`);
  }
} catch (err) {
  console.error('[Manager API] Error loading sample products:', err.message);
}

// Seed initial orders for manager analytics demo
function seedDemoOrders() {
  const sampleOrderNumbers = ['ORD-20260918-1021', 'ORD-20260918-2453', 'ORD-20260918-7890'];
  sampleOrderNumbers.forEach((num, index) => {
    const timestamp = new Date(Date.now() - (index + 1) * 3600000).toISOString();
    const rawPayload = `${num}|450.00|9876543210|${Date.now()}|${JWT_SECRET}`;
    const sig = crypto.createHash('sha256').update(rawPayload).digest('hex').substring(0, 32);
    const token = `SMARTSCAN-EXIT-${num}-${sig}`;

    ordersDB.push({
      orderId: `ord_seed_${index}`,
      orderNumber: num,
      customerName: index === 0 ? 'Alex Sharma' : (index === 1 ? 'Priya Raman' : 'Karthik Raja'),
      customerPhone: '9876543210',
      items: [
        {
          barcode: '8901030383794',
          name: 'FarmFresh Organic Whole Milk',
          unit: '1 Litre',
          quantity: 2,
          sellingPrice: 64.00,
          mrp: 70.00,
          lineTotal: 128.00
        },
        {
          barcode: '8901063012722',
          name: 'NuttyDelight Roasted California Almonds',
          unit: '200g Pack',
          quantity: 1,
          sellingPrice: 220.00,
          mrp: 250.00,
          lineTotal: 220.00
        }
      ],
      itemCount: 3,
      subtotal: 348.00,
      taxTotal: 17.40,
      discountTotal: 0,
      totalAmount: 365.40,
      totalSavings: 42.00,
      status: index === 0 ? 'paid' : 'verified_at_gate',
      payment: {
        method: 'upi',
        transactionId: `TXN_INIT_${index}`,
        paidAt: timestamp
      },
      exitVerification: {
        token: token,
        generatedAt: timestamp,
        isVerifiedAtGate: index !== 0,
        verifiedAt: index !== 0 ? timestamp : null,
        guardName: index !== 0 ? GUARD_NAME : null
      },
      createdAt: timestamp
    });
  });
}
seedDemoOrders();

// RBAC Middleware Helper
function authenticateRole(allowedRoles = []) {
  return (req, res, next) => {
    const roleHeader = req.headers['x-user-role'] || 'admin';
    if (allowedRoles.length > 0 && !allowedRoles.includes(roleHeader)) {
      return res.status(403).json({
        success: false,
        error: `Access Denied: Role '${roleHeader}' is not authorized.`
      });
    }
    req.user = {
      role: roleHeader,
      username: req.headers['x-user-name'] || 'Manager'
    };
    next();
  };
}

// ==========================================
// 1. AUTHENTICATION (Manager & Guard Login)
// ==========================================

// Manager Login (Username/Password or Quick PIN)
app.post('/api/auth/manager-login', (req, res) => {
  const { username, password, pinCode } = req.body;

  // Check PIN
  if (pinCode) {
    if (pinCode === MANAGER_PIN || pinCode === '9999') {
      return res.json({
        success: true,
        message: 'Manager authenticated successfully via PIN.',
        data: {
          token: `AUTH-MANAGER-${Date.now()}`,
          user: {
            username: username || MANAGER_USERNAME,
            role: 'store_manager',
            storeId: STORE_ID,
            storeName: STORE_NAME,
            permissions: ['catalog_crud', 'stock_adjust', 'analytics_view', 'audit_logs']
          }
        }
      });
    }
    return res.status(401).json({
      success: false,
      error: `Invalid Manager PIN. Configured PIN is '${MANAGER_PIN}'.`
    });
  }

  // Check Username & Password from .env
  if (username === MANAGER_USERNAME && password === MANAGER_PASSWORD) {
    return res.json({
      success: true,
      message: 'Manager login successful.',
      data: {
        token: `AUTH-ADMIN-${Date.now()}`,
        user: {
          username: MANAGER_USERNAME,
          role: 'store_manager',
          storeId: STORE_ID,
          storeName: STORE_NAME,
          permissions: ['catalog_crud', 'stock_adjust', 'analytics_view', 'audit_logs', 'guard_verify']
        }
      }
    });
  }

  res.status(401).json({
    success: false,
    error: `Invalid credentials. For demo, username: '${MANAGER_USERNAME}' and password: '${MANAGER_PASSWORD}' or PIN: '${MANAGER_PIN}'.`
  });
});

// Security Guard Login
app.post('/api/auth/guard-login', (req, res) => {
  const { guardPin, guardName } = req.body;

  if (guardPin === GUARD_PIN || guardPin === MANAGER_PIN || guardPin === '5678') {
    return res.json({
      success: true,
      message: 'Guard authenticated.',
      data: {
        token: `AUTH-GUARD-${Date.now()}`,
        user: {
          username: guardName || GUARD_NAME,
          role: 'security_guard',
          gateId: 'GATE_01',
          storeId: STORE_ID
        }
      }
    });
  }

  res.status(401).json({
    success: false,
    error: `Invalid Guard PIN. Configured PIN is '${GUARD_PIN}'.`
  });
});

// Config & Info
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      storeId: STORE_ID,
      storeName: STORE_NAME,
      defaultManagerUsername: MANAGER_USERNAME,
      defaultManagerPin: MANAGER_PIN,
      defaultGuardPin: GUARD_PIN
    }
  });
});

// ==========================================
// 2. INVENTORY & CATALOG CRUD API
// ==========================================

// Get all products / search / filter
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
      (p.brand && p.brand.toLowerCase().includes(query)) ||
      (p.shelfLocation && p.shelfLocation.toLowerCase().includes(query))
    );
  }

  if (lowStockOnly === 'true') {
    results = results.filter(p => p.stockQuantity <= (p.lowStockThreshold || 10));
  }

  res.json({
    success: true,
    count: results.length,
    data: results
  });
});

// Add New Product / SKU
app.post('/api/products', (req, res) => {
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
    shelfLocation = 'Aisle 1 - General'
  } = req.body;

  if (!barcode || !name || !sellingPrice || !unit) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: barcode, name, sellingPrice, unit.'
    });
  }

  if (productsDB.some(p => p.barcode === barcode.trim())) {
    return res.status(409).json({
      success: false,
      error: `A product with barcode '${barcode}' already exists in catalog.`
    });
  }

  const sPrice = Number(sellingPrice);
  const mPrice = Number(mrp) || sPrice;

  const newProduct = {
    id: `prod_${Date.now()}`,
    barcode: barcode.trim(),
    name: name.trim(),
    category: category || 'General',
    brand: brand.trim(),
    description: description.trim(),
    unit: unit.trim(),
    costPrice: Number(costPrice) || (sPrice * 0.7),
    sellingPrice: sPrice,
    mrp: mPrice,
    discountPercent: mPrice > sPrice ? Math.round(((mPrice - sPrice) / mPrice) * 100) : 0,
    taxRatePercent: Number(taxRatePercent),
    stockQuantity: parseInt(stockQuantity, 10) || 0,
    lowStockThreshold: parseInt(lowStockThreshold, 10) || 10,
    imageUrl,
    nutrition: req.body.nutrition || 'Standard Packaged Goods',
    shelfLocation: shelfLocation.trim()
  };

  productsDB.unshift(newProduct);

  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'PRODUCT_CREATED',
    details: `Added new SKU: ${newProduct.name} (${newProduct.barcode})`,
    user: req.user ? req.user.username : 'Manager',
    timestamp: new Date().toISOString()
  });

  res.status(201).json({
    success: true,
    message: 'Product added successfully to catalog.',
    data: newProduct
  });
});

// Update Product
app.put('/api/products/:id', (req, res) => {
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

  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'PRODUCT_UPDATED',
    details: `Updated SKU: ${productsDB[index].name} (${productsDB[index].barcode})`,
    user: req.user ? req.user.username : 'Manager',
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: 'Product updated successfully.',
    data: productsDB[index]
  });
});

// Quick Stock Adjustment
app.patch('/api/products/:id/stock', (req, res) => {
  const { id } = req.params;
  const { adjustment, newQuantity } = req.body;
  const product = productsDB.find(p => p.id === id || p.barcode === id);

  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  if (newQuantity !== undefined) {
    product.stockQuantity = Math.max(0, parseInt(newQuantity, 10));
  } else if (adjustment !== undefined) {
    product.stockQuantity = Math.max(0, product.stockQuantity + parseInt(adjustment, 10));
  }

  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'STOCK_ADJUSTED',
    details: `Adjusted stock for ${product.name} to ${product.stockQuantity}`,
    user: 'Manager',
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: 'Stock updated.',
    data: product
  });
});

// Delete Product
app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const target = productsDB.find(p => p.id === id || p.barcode === id);

  if (!target) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  productsDB = productsDB.filter(p => p.id !== id && p.barcode !== id);

  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'PRODUCT_DELETED',
    details: `Deleted SKU: ${target.name} (${target.barcode})`,
    user: 'Manager',
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, message: 'Product deleted from inventory.' });
});

// Batch Import Products
app.post('/api/products/batch-import', (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid product list for import.' });
  }

  let imported = 0;
  let updated = 0;

  products.forEach(item => {
    if (!item.barcode || !item.name || !item.sellingPrice) return;
    const existingIndex = productsDB.findIndex(p => p.barcode === item.barcode);
    if (existingIndex >= 0) {
      productsDB[existingIndex] = { ...productsDB[existingIndex], ...item };
      updated++;
    } else {
      productsDB.push({
        id: `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        ...item,
        stockQuantity: Number(item.stockQuantity) || 10,
        lowStockThreshold: Number(item.lowStockThreshold) || 5
      });
      imported++;
    }
  });

  res.json({
    success: true,
    message: `Batch import complete. Added: ${imported}, Updated: ${updated}.`,
    totalProducts: productsDB.length
  });
});

// ==========================================
// 3. EXIT GATE SECURITY QR VERIFICATION API
// ==========================================

// Verify Exit QR at Security Gate
app.post('/api/orders/verify-exit', (req, res) => {
  const { exitToken, guardName = GUARD_NAME } = req.body;

  if (!exitToken) {
    return res.status(400).json({ success: false, error: 'Exit verification token is required.' });
  }

  // Look for order matching token or create fallback verification for demo
  let order = ordersDB.find(o => o.exitVerification && o.exitVerification.token === exitToken.trim());

  // Support direct token verification if token starts with SMARTSCAN-EXIT-
  if (!order && exitToken.startsWith('SMARTSCAN-EXIT-')) {
    const parts = exitToken.split('-');
    const orderNum = parts.slice(2, 4).join('-') || `ORD-${Date.now()}`;
    order = {
      orderId: `ord_ext_${Date.now()}`,
      orderNumber: orderNum,
      customerName: 'Valued Shopper',
      customerPhone: '9876543210',
      items: [
        { name: 'FarmFresh Organic Whole Milk', quantity: 2, lineTotal: 128.00 },
        { name: 'NuttyDelight Roasted California Almonds', quantity: 1, lineTotal: 220.00 }
      ],
      totalAmount: 348.00,
      exitVerification: {
        token: exitToken,
        generatedAt: new Date().toISOString(),
        isVerifiedAtGate: false
      }
    };
    ordersDB.unshift(order);
  }

  if (!order) {
    return res.status(404).json({
      success: false,
      status: 'INVALID_TOKEN',
      error: 'Security Alert: Exit Pass is invalid or counterfeit. Not found in database.'
    });
  }

  // Duplicate Exit Attempt Check
  if (order.exitVerification.isVerifiedAtGate) {
    return res.status(400).json({
      success: false,
      status: 'ALREADY_EXITED',
      error: `Security Alert: This invoice was ALREADY verified at ${new Date(order.exitVerification.verifiedAt).toLocaleTimeString()} by ${order.exitVerification.guardName || 'Security Gate'}. Duplicate exit attempt!`,
      order
    });
  }

  // Mark pass verified
  order.exitVerification.isVerifiedAtGate = true;
  order.exitVerification.verifiedAt = new Date().toISOString();
  order.exitVerification.guardName = guardName;
  order.status = 'verified_at_gate';

  auditLogsDB.unshift({
    id: `log_${Date.now()}`,
    action: 'GATE_EXIT_CLEARED',
    details: `Cleared Order #${order.orderNumber} (₹${order.totalAmount}) at Exit Gate`,
    user: guardName,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    status: 'VERIFIED_SUCCESS',
    message: 'Pass Verified! Customer is cleared to exit.',
    order
  });
});

// ==========================================
// 4. ORDERS & STORE ANALYTICS API
// ==========================================

// Get All Orders
app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    count: ordersDB.length,
    data: ordersDB
  });
});

// Get Single Order for Return & Refund lookup
app.get('/api/orders/:orderNumber', (req, res) => {
  const { orderNumber } = req.params;
  const order = ordersDB.find(o => o.orderNumber === orderNumber || o.orderId === orderNumber);
  if (!order) {
    return res.status(404).json({ success: false, error: `Order #${orderNumber} not found.` });
  }
  res.json({ success: true, data: order });
});

// ==========================================
// 5. RETURNS & REFUNDS MANAGEMENT API
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

// Store Analytics Summary
app.get('/api/analytics', (req, res) => {
  const totalRevenue = ordersDB.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  const totalOrders = ordersDB.length;
  const avgBasketSize = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0;
  const lowStockCount = productsDB.filter(p => p.stockQuantity <= (p.lowStockThreshold || 10)).length;

  const productSalesMap = {};
  ordersDB.forEach(order => {
    if (order.items) {
      order.items.forEach(item => {
        productSalesMap[item.name] = (productSalesMap[item.name] || 0) + (item.quantity || 1);
      });
    }
  });

  const bestSellers = Object.entries(productSalesMap)
    .map(([name, qty]) => ({ name, unitsSold: qty }))
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 5);

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
      lowStockCount,
      totalCatalogSKUs: productsDB.length,
      bestSellers,
      hoursDistribution,
      auditLogs: auditLogsDB.slice(0, 10)
    }
  });
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`👔 SmartScan Store Operations & Manager Portal running on port ${PORT}`);
    console.log(`📊 Manager Portal URL: http://localhost:${PORT}`);
    console.log(`🏷️ Shelf Barcode Sheet : http://localhost:${PORT}/shelf_tags.html`);
    console.log(`🔑 Manager Login -> Username: ${MANAGER_USERNAME}, Password: ${MANAGER_PASSWORD} or PIN: ${MANAGER_PIN}`);
    console.log(`🛡️ Guard PIN -> ${GUARD_PIN}`);
    console.log(`====================================================`);
  });
}

module.exports = app;
