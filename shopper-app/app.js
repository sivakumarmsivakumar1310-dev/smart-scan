/**
 * SmartScan Shopper Mobile App & Self-Checkout Controller
 * Connects directly to Shopper Express Backend API
 */

(function () {
  'use strict';

  const FALLBACK_CATALOG = [
    {
      id: "prod_001",
      barcode: "8901030383794",
      name: "FarmFresh Organic Whole Milk",
      category: "Dairy & Eggs",
      brand: "FarmFresh",
      unit: "1 Litre",
      costPrice: 42.00,
      sellingPrice: 64.00,
      mrp: 70.00,
      discountPercent: 8.5,
      taxRatePercent: 5.0,
      stockQuantity: 45,
      lowStockThreshold: 15,
      imageUrl: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&auto=format&fit=crop&q=80",
      shelfLocation: "Aisle 2 - Cooler B3"
    },
    {
      id: "prod_002",
      barcode: "8901491101838",
      name: "Artisan Sourdough Loaf",
      category: "Bakery",
      brand: "Golden Crust",
      unit: "450g",
      costPrice: 55.00,
      sellingPrice: 89.00,
      mrp: 99.00,
      discountPercent: 10.0,
      taxRatePercent: 5.0,
      stockQuantity: 28,
      lowStockThreshold: 10,
      imageUrl: "https://images.unsplash.com/photo-1589367920969-ab8e050bbb04?w=600&auto=format&fit=crop&q=80",
      shelfLocation: "Aisle 1 - Bakery Rack A"
    },
    {
      id: "prod_003",
      barcode: "8901063012722",
      name: "NuttyDelight Roasted California Almonds",
      category: "Snacks & Dry Fruits",
      brand: "NuttyDelight",
      unit: "200g Pack",
      costPrice: 160.00,
      sellingPrice: 220.00,
      mrp: 250.00,
      discountPercent: 12.0,
      taxRatePercent: 12.0,
      stockQuantity: 60,
      lowStockThreshold: 20,
      imageUrl: "https://images.unsplash.com/photo-1508061252445-5350f3777130?w=600&auto=format&fit=crop&q=80",
      shelfLocation: "Aisle 4 - Rack 2"
    },
    {
      id: "prod_004",
      barcode: "8901207040475",
      name: "PureBrew Single-Origin Arabica Coffee Beans",
      category: "Beverages",
      brand: "PureBrew",
      unit: "250g Tin",
      costPrice: 240.00,
      sellingPrice: 349.00,
      mrp: 399.00,
      discountPercent: 12.5,
      taxRatePercent: 18.0,
      stockQuantity: 18,
      lowStockThreshold: 8,
      imageUrl: "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600&auto=format&fit=crop&q=80",
      shelfLocation: "Aisle 3 - Shelf C"
    },
    {
      id: "prod_005",
      barcode: "8901725112111",
      name: "Olea Vera Extra Virgin Olive Oil",
      category: "Gourmet & Cooking",
      brand: "Olea Vera",
      unit: "500ml Glass Bottle",
      costPrice: 380.00,
      sellingPrice: 520.00,
      mrp: 599.00,
      discountPercent: 13.0,
      taxRatePercent: 5.0,
      stockQuantity: 8,
      lowStockThreshold: 10,
      imageUrl: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80",
      shelfLocation: "Aisle 5 - Aisle Endcap"
    }
  ];

  // API Base URL config: supports direct port 3001, Live Server (e.g. 5500), or file://
  const API_BASE = (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3001'))
    ? 'http://localhost:3001'
    : '';

  const AppState = {
    user: null,
    sessionToken: null,
    cart: [],
    detectedProduct: null,
    appliedCoupon: null,
    couponDiscount: 0,
    scannerInstance: null,
    catalog: [...FALLBACK_CATALOG],
    serverConfig: null,
    orders: [],
    lastOrder: null
  };

  // Sound Synthesizer (for scan & checkout)
  const soundPlayer = {
    ctx: null,
    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    playSuccess() {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880.00, now + 0.1); // A5
        osc.frequency.setValueAtTime(1174.66, now + 0.2); // D6

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
      } catch (e) {}
    }
  };

  // Toast Notification
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Generate SVG QR Code
  function renderSvgQR(payload) {
    const hash = Array.from(payload).reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    let rects = '';
    const size = 21;
    const cellSize = 7;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const isCorner = (r < 6 && c < 6) || (r < 6 && c >= size - 6) || (r >= size - 6 && c < 6);
        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
                         (r >= 2 && r <= 4 && c >= size - 5 && c <= size - 3) ||
                         (r >= size - 5 && r <= size - 3 && c >= 2 && c <= 4);
        const isBorder = isCorner && (r === 0 || r === 5 || c === 0 || c === 5 ||
                         r === size - 6 || r === size - 1 || c === size - 6 || c === size - 1);

        const pseudoBit = ((hash ^ (r * 31 + c * 17)) & (1 << ((r + c) % 8))) !== 0;

        if (isBorder || isCenter || (!isCorner && pseudoBit)) {
          rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#0f172a" />`;
        }
      }
    }

    return `<svg viewBox="0 0 ${size * cellSize} ${size * cellSize}" style="width:160px; height:160px; display:block;">
      <rect width="100%" height="100%" fill="#ffffff" />
      ${rects}
    </svg>`;
  }

  // Load Server Config & Catalog
  async function loadInitialData() {
    // 1. Load from localStorage if present
    const savedCatalog = localStorage.getItem('smartscan_catalog');
    if (savedCatalog) {
      try {
        const parsed = JSON.parse(savedCatalog);
        if (Array.isArray(parsed) && parsed.length > 0) {
          AppState.catalog = parsed;
          renderSimulatorChips(AppState.catalog);
        }
      } catch (e) {}
    }

    try {
      if (API_BASE) {
        const configRes = await fetch(`${API_BASE}/api/config`).catch(() => null);
        if (configRes && configRes.ok) {
          const configData = await configRes.json();
          if (configData.success) {
            AppState.serverConfig = configData.data;
            const phoneInput = document.getElementById('login-phone');
            const passInput = document.getElementById('login-password');
            if (phoneInput && configData.data.demoCredentials) {
              phoneInput.value = configData.data.demoCredentials.phone;
            }
            if (passInput && configData.data.demoCredentials) {
              passInput.value = configData.data.demoCredentials.password;
            }
          }
        }

        const prodRes = await fetch(`${API_BASE}/api/products`).catch(() => null);
        if (prodRes && prodRes.ok) {
          const prodData = await prodRes.json();
          if (prodData.success && Array.isArray(prodData.data) && prodData.data.length > 0) {
            AppState.catalog = prodData.data;
            localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
            renderSimulatorChips(AppState.catalog);
          }
        }
      }
    } catch (e) {
      console.warn('Backend connection note:', e.message);
    }

    // Fallback load from sample_products.json if catalog is still minimal
    if (!AppState.catalog || AppState.catalog.length <= 5) {
      try {
        const localRes = await fetch('./data/sample_products.json').catch(() => fetch('../data/sample_products.json'));
        if (localRes && localRes.ok) {
          const sampleData = await localRes.json();
          if (Array.isArray(sampleData) && sampleData.length > 0) {
            AppState.catalog = sampleData;
            localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
            renderSimulatorChips(AppState.catalog);
          }
        }
      } catch (err) {}
    }
  }

  // Load and Synchronize Multi-Order Persistent History Stack
  async function loadOrderHistory() {
    let localOrders = [];
    const saved = localStorage.getItem('smartscan_shopper_orders');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) localOrders = parsed;
      } catch (e) {}
    }

    // Also check single last order if present and not yet in array
    const savedLast = localStorage.getItem('smartscan_last_order');
    if (savedLast) {
      try {
        const parsedLast = JSON.parse(savedLast);
        if (parsedLast && !localOrders.some(o => o.orderNumber === parsedLast.orderNumber)) {
          localOrders.unshift(parsedLast);
        }
      } catch (e) {}
    }

    AppState.orders = localOrders;

    // Synchronize with server if backend API is connected
    if (API_BASE) {
      try {
        const phone = AppState.user ? AppState.user.phone : '';
        const url = phone ? `${API_BASE}/api/orders?phone=${encodeURIComponent(phone)}` : `${API_BASE}/api/orders`;
        const res = await fetch(url).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.data)) {
            data.data.forEach(srvOrder => {
              if (!AppState.orders.some(o => o.orderNumber === srvOrder.orderNumber)) {
                AppState.orders.push(srvOrder);
              }
            });
          }
        }
      } catch (e) {}
    }

    // Sort descending by date (newest first)
    AppState.orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    localStorage.setItem('smartscan_shopper_orders', JSON.stringify(AppState.orders));
    if (AppState.orders.length > 0) {
      AppState.lastOrder = AppState.orders[0];
    }
    updateOrderHistoryBadges();
  }

  // Update order history badges in header and session bar
  function updateOrderHistoryBadges() {
    const count = AppState.orders ? AppState.orders.length : 0;
    const headerBadge = document.getElementById('header-orders-badge');
    const sessionBadge = document.getElementById('session-orders-badge');
    if (headerBadge) headerBadge.textContent = count;
    if (sessionBadge) sessionBadge.textContent = count;
  }

  // Render quick simulator buttons
  function renderSimulatorChips(products) {
    const container = document.getElementById('simulator-chips-container');
    if (!container || !products || products.length === 0) return;

    container.innerHTML = products.slice(0, 5).map(p => `
      <button type="button" class="sim-chip" data-barcode="${p.barcode}">
        <span>🔍</span> ${p.name.split(' ')[0]} (₹${p.sellingPrice})
      </button>
    `).join('');

    container.querySelectorAll('.sim-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const barcode = btn.getAttribute('data-barcode');
        handleBarcodeScanned(barcode);
      });
    });
  }

  // Handle Auth Session
  function restoreSession() {
    const saved = localStorage.getItem('smartscan_shopper_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        AppState.user = parsed.user;
        AppState.sessionToken = parsed.sessionToken;
        showShoppingView();
        return;
      } catch (e) {}
    }
    showAuthView();
  }

  function showAuthView() {
    const authSec = document.getElementById('shopper-auth-sec');
    const scanSec = document.getElementById('shopper-scan-sec');
    if (authSec) authSec.style.display = 'block';
    if (scanSec) scanSec.style.display = 'none';
  }

  function showShoppingView() {
    const authSec = document.getElementById('shopper-auth-sec');
    const scanSec = document.getElementById('shopper-scan-sec');
    const userDisplay = document.getElementById('shopper-user-display');

    if (authSec) authSec.style.display = 'none';
    if (scanSec) scanSec.style.display = 'block';
    if (userDisplay && AppState.user) {
      userDisplay.textContent = AppState.user.fullName || 'Shopper';
    }

    initScanner();
    renderCart();
  }

  // Scanner Initialization
  function initScanner() {
    if (AppState.scannerInstance) return;

    AppState.scannerInstance = new SmartBarcodeScanner({
      videoElementId: 'reader-container',
      onDetected: (barcode) => handleBarcodeScanned(barcode),
      onStatusChange: ({ status, message }) => {
        const statusEl = document.getElementById('scanner-status-text');
        if (statusEl) statusEl.textContent = message;
      },
      onError: (err) => {
        console.warn('Scanner message:', err);
      }
    });

    AppState.scannerInstance.start().catch(() => {});
  }

  // Handle Scanned Barcode
  async function handleBarcodeScanned(barcode) {
    if (!barcode) return;

    try {
      const res = await fetch(`${API_BASE}/api/products/scan/${barcode.trim()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          showDetectedProduct(json.data);
          return;
        }
      }
    } catch (e) {}

    // Fallback: check locally loaded catalog
    const localProd = AppState.catalog.find(p => p.barcode === barcode.trim());
    if (localProd) {
      showDetectedProduct(localProd);
      return;
    }

    showToast(`Barcode ${barcode} not found in store.`, 'error');
  }

  // Display Detected Product Card
  function showDetectedProduct(product) {
    AppState.detectedProduct = { ...product, selectedQty: 1 };

    const card = document.getElementById('detection-card');
    const cat = document.getElementById('det-cat');
    const img = document.getElementById('det-img');
    const title = document.getElementById('det-title');
    const unit = document.getElementById('det-unit');
    const price = document.getElementById('det-price');
    const mrp = document.getElementById('det-mrp');
    const discount = document.getElementById('det-discount');
    const qtyVal = document.getElementById('det-qty-val');

    if (cat) cat.textContent = product.category || 'General';
    if (img) img.src = product.imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80';
    if (title) title.textContent = product.name;
    if (unit) unit.textContent = product.unit || '1 unit';
    if (price) price.textContent = `₹${Number(product.sellingPrice).toFixed(2)}`;
    if (mrp) mrp.textContent = `₹${Number(product.mrp || product.sellingPrice).toFixed(2)}`;
    if (discount) {
      const disc = product.discountPercent || (product.mrp > product.sellingPrice ? Math.round(((product.mrp - product.sellingPrice) / product.mrp) * 100) : 0);
      discount.textContent = `${disc}% OFF`;
      discount.style.display = disc > 0 ? 'inline-block' : 'none';
    }
    if (qtyVal) qtyVal.textContent = '1';

    if (card) card.style.display = 'block';
    showToast(`Scanned: ${product.name}`, 'success');
  }

  function hideDetectedProduct() {
    const card = document.getElementById('detection-card');
    if (card) card.style.display = 'none';
    AppState.detectedProduct = null;
  }

  // Cart Management
  function addToCart(product, qty = 1) {
    const existingIndex = AppState.cart.findIndex(i => i.barcode === product.barcode);
    if (existingIndex >= 0) {
      AppState.cart[existingIndex].quantity += qty;
    } else {
      AppState.cart.push({
        ...product,
        quantity: qty
      });
    }

    renderCart();
    hideDetectedProduct();
    showToast(`Added ${product.name} to cart`, 'success');
    syncCartWithServer();
  }

  function updateCartItemQty(barcode, change) {
    const item = AppState.cart.find(i => i.barcode === barcode);
    if (!item) return;

    item.quantity += change;
    if (item.quantity <= 0) {
      AppState.cart = AppState.cart.filter(i => i.barcode !== barcode);
      showToast('Item removed from cart', 'info');
    }
    renderCart();
    syncCartWithServer();
  }

  function renderCart() {
    const emptyState = document.getElementById('cart-empty-state');
    const itemsList = document.getElementById('cart-items-list');
    const countBadge = document.getElementById('cart-count-badge');
    const subtotalEl = document.getElementById('bill-subtotal');
    const taxEl = document.getElementById('bill-tax');
    const savingsEl = document.getElementById('bill-savings');
    const grandTotalEl = document.getElementById('bill-grand-total');

    const bottomBar = document.getElementById('bottom-checkout-bar');
    const bottomItemCount = document.getElementById('bottom-item-count');
    const bottomGrandTotal = document.getElementById('bottom-grand-total');

    const totalCount = AppState.cart.reduce((sum, item) => sum + item.quantity, 0);

    if (countBadge) countBadge.textContent = `${totalCount} items`;
    if (bottomItemCount) bottomItemCount.textContent = `${totalCount} item${totalCount === 1 ? '' : 's'}`;

    if (AppState.cart.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (itemsList) itemsList.innerHTML = '';
      if (subtotalEl) subtotalEl.textContent = '₹0.00';
      if (taxEl) taxEl.textContent = '₹0.00';
      if (savingsEl) savingsEl.textContent = '₹0.00';
      if (grandTotalEl) grandTotalEl.textContent = '₹0.00';
      if (bottomBar) bottomBar.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    let subtotal = 0;
    let taxTotal = 0;
    let savingsTotal = 0;

    let itemsHtml = '';
    AppState.cart.forEach(item => {
      const itemPrice = Number(item.sellingPrice);
      const itemMrp = Number(item.mrp || itemPrice);
      const taxRate = Number(item.taxRatePercent || 5.0);
      const lineTotal = itemPrice * item.quantity;
      const lineTax = (lineTotal * taxRate) / 100;
      const lineSavings = (itemMrp - itemPrice) * item.quantity;

      subtotal += lineTotal;
      taxTotal += lineTax;
      savingsTotal += lineSavings;

      itemsHtml += `
        <div class="cart-item-row">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-sub">₹${itemPrice.toFixed(2)} × ${item.quantity} (${item.unit || '1 unit'})</div>
          </div>
          <div style="display:flex; align-items:center;">
            <div class="cart-item-price">₹${lineTotal.toFixed(2)}</div>
            <div class="qty-stepper" style="padding:2px 6px; gap:8px;">
              <button type="button" class="qty-btn" style="width:22px; height:22px; font-size:0.9rem;" onclick="window.SmartShopper.updateQty('${item.barcode}', -1)">-</button>
              <span class="qty-val" style="font-size:0.85rem;">${item.quantity}</span>
              <button type="button" class="qty-btn" style="width:22px; height:22px; font-size:0.9rem;" onclick="window.SmartShopper.updateQty('${item.barcode}', 1)">+</button>
            </div>
            <button type="button" class="cart-remove-btn" onclick="window.SmartShopper.updateQty('${item.barcode}', -999)" title="Remove">✕</button>
          </div>
        </div>
      `;
    });

    if (itemsList) itemsList.innerHTML = itemsHtml;

    const finalSavings = savingsTotal + AppState.couponDiscount;
    const grandTotal = Math.max(0, subtotal + taxTotal - AppState.couponDiscount);

    if (subtotalEl) subtotalEl.textContent = `₹${subtotal.toFixed(2)}`;
    if (taxEl) taxEl.textContent = `₹${taxTotal.toFixed(2)}`;
    if (savingsEl) savingsEl.textContent = `₹${finalSavings.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;

    if (bottomGrandTotal) bottomGrandTotal.textContent = `₹${grandTotal.toFixed(2)}`;
    if (bottomBar) bottomBar.style.display = 'flex';
  }

  async function syncCartWithServer() {
    if (!AppState.sessionToken) return;
    try {
      await fetch(`${API_BASE}/api/cart/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: AppState.sessionToken,
          customerName: AppState.user ? AppState.user.fullName : 'Shopper',
          customerPhone: AppState.user ? AppState.user.phone : '9876543210',
          items: AppState.cart
        })
      });
    } catch (e) {}
  }

  // Promo Code Validation
  async function applyCoupon() {
    const input = document.getElementById('coupon-input');
    const msg = document.getElementById('coupon-msg');
    if (!input) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
      if (msg) {
        msg.textContent = 'Please enter a coupon code.';
        msg.style.color = 'var(--danger)';
      }
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();

      if (data.success && data.valid) {
        AppState.appliedCoupon = code;
        AppState.couponDiscount = Number(data.discountAmount) || 0;
        if (msg) {
          msg.textContent = data.message;
          msg.style.color = 'var(--primary)';
        }
        renderCart();
        showToast(`Promo ${code} applied! Saved ₹${AppState.couponDiscount}`, 'success');
      } else {
        if (msg) {
          msg.textContent = data.error || 'Invalid coupon.';
          msg.style.color = 'var(--danger)';
        }
      }
    } catch (e) {
      if (msg) {
        msg.textContent = 'Error verifying coupon.';
        msg.style.color = 'var(--danger)';
      }
    }
  }

  // Checkout Execution
  async function executeCheckout(paymentMethod = 'upi') {
    if (AppState.cart.length === 0) {
      showToast('Your cart is empty.', 'error');
      return;
    }

    const payload = {
      customerName: AppState.user ? AppState.user.fullName : 'Shopper',
      customerPhone: AppState.user ? AppState.user.phone : '9876543210',
      cartItems: AppState.cart,
      paymentMethod,
      appliedDiscount: AppState.couponDiscount,
      sessionToken: AppState.sessionToken
    };

    let orderData = null;

    try {
      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          orderData = data.data;
        }
      }
    } catch (err) {
      console.warn('Server checkout request note:', err.message);
    }

    // Local fallback generation if server is offline/standalone static
    if (!orderData) {
      let subtotal = 0;
      let taxTotal = 0;
      let totalSavings = 0;
      const orderItems = [];
      const taxRateMap = {};

      AppState.cart.forEach(item => {
        const qty = item.quantity || 1;
        const price = Number(item.sellingPrice);
        const mrp = Number(item.mrp || price);
        const taxRate = Number(item.taxRatePercent || 5.0);
        const lineTotal = price * qty;
        const itemTax = (lineTotal * taxRate) / 100;
        const itemSavings = (mrp - price) * qty;

        subtotal += lineTotal;
        taxTotal += itemTax;
        totalSavings += itemSavings;

        if (!taxRateMap[taxRate]) taxRateMap[taxRate] = { taxable: 0, tax: 0 };
        taxRateMap[taxRate].taxable += lineTotal;
        taxRateMap[taxRate].tax += itemTax;

        orderItems.push({
          barcode: item.barcode,
          name: item.name,
          brand: item.brand || '',
          unit: item.unit || '1 unit',
          quantity: qty,
          sellingPrice: price,
          mrp: mrp,
          taxRatePercent: taxRate,
          taxAmount: Number(itemTax.toFixed(2)),
          itemSavings: Number(itemSavings.toFixed(2)),
          lineTotal: Number(lineTotal.toFixed(2))
        });
      });

      const grandTotal = Math.max(0, subtotal + taxTotal - AppState.couponDiscount);
      const now = new Date();
      const orderNum = `ORD-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const token = `SMARTSCAN-EXIT-${orderNum}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

      const gstBreakdown = Object.keys(taxRateMap).map(rate => ({
        ratePercent: Number(rate),
        taxableAmount: Number(taxRateMap[rate].taxable.toFixed(2)),
        taxAmount: Number(taxRateMap[rate].tax.toFixed(2)),
        cgstAmount: Number((taxRateMap[rate].tax / 2).toFixed(2)),
        sgstAmount: Number((taxRateMap[rate].tax / 2).toFixed(2))
      }));

      orderData = {
        orderId: `ord_${Date.now()}`,
        orderNumber: orderNum,
        storeId: 'STORE_104',
        storeName: 'Smart Supermarket • Central Hub',
        storeAddress: 'Smart Supermarket, Level 1, Retail Hub, Connaught Place, New Delhi',
        storeGstin: '07AABCS1429B1Z8',
        storeFssai: '10019011000123',
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        items: orderItems,
        itemCount: orderItems.reduce((sum, i) => sum + i.quantity, 0),
        subtotal: Number(subtotal.toFixed(2)),
        taxTotal: Number(taxTotal.toFixed(2)),
        cgstTotal: Number((taxTotal / 2).toFixed(2)),
        sgstTotal: Number((taxTotal / 2).toFixed(2)),
        igstTotal: 0.00,
        gstBreakdown,
        discountTotal: AppState.couponDiscount,
        totalAmount: Number(grandTotal.toFixed(2)),
        totalSavings: Number((totalSavings + AppState.couponDiscount).toFixed(2)),
        status: 'paid',
        payment: {
          method: paymentMethod,
          methodLabel: paymentMethod === 'upi' ? 'UPI Instant Pay' : (paymentMethod === 'card' ? 'Debit/Credit Card' : 'Fast Counter Cash'),
          transactionId: `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
          paidAt: now.toISOString(),
          status: 'SUCCESS'
        },
        exitVerification: {
          token,
          generatedAt: now.toISOString(),
          isVerifiedAtGate: false,
          verifiedAt: null,
          guardName: null
        },
        createdAt: now.toISOString()
      };
    }

    if (orderData) {
      soundPlayer.playSuccess();
      closeModal('payment-modal');

      // Accumulate order in persistent history stack (never overwrite past orders)
      if (!AppState.orders) AppState.orders = [];
      const existingIdx = AppState.orders.findIndex(o => o.orderNumber === orderData.orderNumber);
      if (existingIdx >= 0) {
        AppState.orders[existingIdx] = orderData;
      } else {
        AppState.orders.unshift(orderData);
      }
      localStorage.setItem('smartscan_shopper_orders', JSON.stringify(AppState.orders));

      // Save latest order reference
      AppState.lastOrder = orderData;
      localStorage.setItem('smartscan_last_order', JSON.stringify(orderData));
      updateOrderHistoryBadges();

      // Display the comprehensive Digital Bill / Tax Invoice & Exit Pass
      displayDigitalInvoiceAndExitPass(orderData);

      // Instantly clear the shopping cart
      AppState.cart = [];
      AppState.appliedCoupon = null;
      AppState.couponDiscount = 0;
      const couponInput = document.getElementById('coupon-input');
      const couponMsg = document.getElementById('coupon-msg');
      if (couponInput) couponInput.value = '';
      if (couponMsg) couponMsg.textContent = '';
      renderCart();

      showToast('Payment successful! Digital Tax Invoice generated and saved to Order History.', 'success');
    } else {
      showToast('Unable to complete checkout. Please try again.', 'error');
    }
  }

  // Display Comprehensive Digital Tax Invoice & Exit Gate Pass
  function displayDigitalInvoiceAndExitPass(order) {
    if (!order) return;

    // 1. Store Header & Meta
    const storeNameEl = document.getElementById('inv-store-name');
    const storeAddrEl = document.getElementById('inv-store-address');
    const storeGstinEl = document.getElementById('inv-store-gstin');
    const storeFssaiEl = document.getElementById('inv-store-fssai');
    const storeIdEl = document.getElementById('inv-store-id');

    if (storeNameEl) storeNameEl.textContent = order.storeName || 'Smart Supermarket • Central Hub';
    if (storeAddrEl) storeAddrEl.textContent = order.storeAddress || 'Smart Supermarket, Level 1, Retail Hub, Connaught Place, New Delhi';
    if (storeGstinEl) storeGstinEl.textContent = order.storeGstin || '07AABCS1429B1Z8';
    if (storeFssaiEl) storeFssaiEl.textContent = order.storeFssai || '10019011000123';
    if (storeIdEl) storeIdEl.textContent = order.storeId || 'STORE_104';

    // 2. Invoice & Customer Meta Grid
    const orderNumEl = document.getElementById('inv-order-num');
    const timestampEl = document.getElementById('inv-timestamp');
    const customerInfoEl = document.getElementById('inv-customer-info');
    const paymentInfoEl = document.getElementById('inv-payment-info');

    const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
    const formattedDate = orderDate.toLocaleDateString('en-IN', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    const formattedTime = orderDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    const dynamicTimestampStr = `${formattedDate} • ${formattedTime}`;

    if (orderNumEl) orderNumEl.textContent = order.orderNumber;
    if (timestampEl) timestampEl.textContent = dynamicTimestampStr;
    if (customerInfoEl) customerInfoEl.textContent = `${order.customerName || 'Valued Shopper'} (+91 ${order.customerPhone || '9876543210'})`;

    const paymentLabel = order.payment?.methodLabel || (order.payment?.method ? order.payment.method.toUpperCase() : 'UPI');
    const txnId = order.payment?.transactionId || `TXN_${Date.now()}`;
    if (paymentInfoEl) paymentInfoEl.textContent = `${paymentLabel} (${txnId}) • PAID`;

    // 3. Itemized Products Table
    const tbodyEl = document.getElementById('inv-items-tbody');
    if (tbodyEl && Array.isArray(order.items)) {
      tbodyEl.innerHTML = order.items.map((item, idx) => {
        const qty = item.quantity || 1;
        const price = Number(item.sellingPrice || 0);
        const mrp = Number(item.mrp || price);
        const taxRate = Number(item.taxRatePercent || 5.0);
        const taxAmt = Number(item.taxAmount || ((price * qty * taxRate) / 100));
        const lineTot = Number(item.lineTotal || (price * qty));
        const hasDiscount = mrp > price;

        return `
          <tr>
            <td style="color:var(--text-dim);">${idx + 1}</td>
            <td>
              <strong style="color:#fff; font-size:0.88rem;">${item.name}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">
                ${item.brand ? `<span>${item.brand} • </span>` : ''}
                <span>${item.unit || '1 unit'}</span> • 
                <code>${item.barcode}</code>
              </div>
            </td>
            <td style="text-align:center; font-weight:700;">${qty}</td>
            <td style="text-align:right;">
              <div>₹${price.toFixed(2)}</div>
              ${hasDiscount ? `<div style="font-size:0.72rem; color:var(--text-dim); text-decoration:line-through;">₹${mrp.toFixed(2)}</div>` : ''}
            </td>
            <td style="text-align:right;">
              <span class="tax-rate-chip">${taxRate}%</span>
              <div style="font-size:0.72rem; color:var(--text-muted);">₹${taxAmt.toFixed(2)}</div>
            </td>
            <td style="text-align:right; font-weight:800; color:var(--primary);">
              ₹${lineTot.toFixed(2)}
            </td>
          </tr>
        `;
      }).join('');
    }

    // 4. GST Tax Breakdown
    const gstRowsEl = document.getElementById('inv-gst-rows');
    if (gstRowsEl) {
      if (Array.isArray(order.gstBreakdown) && order.gstBreakdown.length > 0) {
        gstRowsEl.innerHTML = `
          <table class="gst-subtable">
            <thead>
              <tr>
                <th>GST Rate</th>
                <th>Taxable Subtotal</th>
                <th>CGST</th>
                <th>SGST</th>
                <th>Total Tax</th>
              </tr>
            </thead>
            <tbody>
              ${order.gstBreakdown.map(g => `
                <tr>
                  <td><strong>${g.ratePercent}% GST</strong></td>
                  <td>₹${g.taxableAmount.toFixed(2)}</td>
                  <td>₹${g.cgstAmount.toFixed(2)} (${(g.ratePercent / 2)}%)</td>
                  <td>₹${g.sgstAmount.toFixed(2)} (${(g.ratePercent / 2)}%)</td>
                  <td style="font-weight:700; color:var(--primary);">₹${g.taxAmount.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else {
        gstRowsEl.innerHTML = `
          <div style="font-size:0.8rem; color:var(--text-muted); display:flex; justify-content:space-between;">
            <span>Standard GST (CGST 2.5% + SGST 2.5%):</span>
            <strong>₹${Number(order.taxTotal || 0).toFixed(2)}</strong>
          </div>
        `;
      }
    }

    // 5. Financial Summary Lines
    const subtotalEl = document.getElementById('inv-subtotal');
    const taxTotalEl = document.getElementById('inv-tax-total');
    const discountRowEl = document.getElementById('inv-discount-row');
    const discountValEl = document.getElementById('inv-discount-val');
    const savingsValEl = document.getElementById('inv-savings-val');
    const grandTotalEl = document.getElementById('inv-grand-total');

    if (subtotalEl) subtotalEl.textContent = `₹${Number(order.subtotal || 0).toFixed(2)}`;
    if (taxTotalEl) {
      const cgst = Number(order.cgstTotal || (order.taxTotal / 2) || 0);
      const sgst = Number(order.sgstTotal || (order.taxTotal / 2) || 0);
      taxTotalEl.textContent = `₹${Number(order.taxTotal || 0).toFixed(2)} (CGST: ₹${cgst.toFixed(2)} + SGST: ₹${sgst.toFixed(2)})`;
    }

    if (discountRowEl && discountValEl) {
      const discount = Number(order.discountTotal || 0);
      if (discount > 0) {
        discountRowEl.style.display = 'flex';
        discountValEl.textContent = `-₹${discount.toFixed(2)}`;
      } else {
        discountRowEl.style.display = 'none';
      }
    }

    if (savingsValEl) {
      const savings = Number(order.totalSavings || 0);
      savingsValEl.textContent = `₹${savings.toFixed(2)}`;
    }

    if (grandTotalEl) grandTotalEl.textContent = `₹${Number(order.totalAmount || 0).toFixed(2)}`;

    // 6. Security Exit Gate Pass Setup
    const qrBox = document.getElementById('pass-qr-box');
    const tokenTextEl = document.getElementById('pass-token-text');
    const passTimestampEl = document.getElementById('pass-timestamp-val');
    const passTotalBadge = document.getElementById('pass-total-badge');
    const passItemsCount = document.getElementById('pass-items-count');
    const passItemsSummary = document.getElementById('pass-items-summary');

    const exitToken = order.exitVerification?.token || `SMARTSCAN-EXIT-${order.orderNumber}`;

    if (tokenTextEl) tokenTextEl.textContent = exitToken;
    if (passTimestampEl) passTimestampEl.textContent = dynamicTimestampStr;
    if (passTotalBadge) passTotalBadge.textContent = `₹${Number(order.totalAmount || 0).toFixed(2)}`;
    if (passItemsCount) passItemsCount.textContent = `${order.itemCount || (order.items ? order.items.length : 0)} items`;

    if (passItemsSummary && Array.isArray(order.items)) {
      passItemsSummary.innerHTML = order.items.map(i => `
        <div class="guard-item-row">
          <span>${i.name} (×${i.quantity})</span>
          <strong style="color:var(--primary);">₹${Number(i.lineTotal).toFixed(2)}</strong>
        </div>
      `).join('');
    }

    // Render Cryptographic QR Code (using QRCode.js standard matrix or SVG fallback)
    if (qrBox) {
      qrBox.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        try {
          new QRCode(qrBox, {
            text: exitToken,
            width: 170,
            height: 170,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
          });
        } catch (e) {
          qrBox.innerHTML = renderSvgQR(exitToken);
        }
      } else {
        qrBox.innerHTML = renderSvgQR(exitToken);
      }
    }

    // Switch default tab to invoice
    switchInvoiceTab('invoice');

    // Open modal
    openModal('exit-pass-modal');
  }

  // Switch tabs between Tax Invoice and Gate Pass
  function switchInvoiceTab(tab) {
    const tabInvoiceBtn = document.getElementById('btn-tab-invoice');
    const tabGatepassBtn = document.getElementById('btn-tab-gatepass');
    const viewInvoice = document.getElementById('view-digital-invoice');
    const viewGatepass = document.getElementById('view-exit-gatepass');

    if (tab === 'invoice') {
      if (tabInvoiceBtn) tabInvoiceBtn.classList.add('active');
      if (tabGatepassBtn) tabGatepassBtn.classList.remove('active');
      if (viewInvoice) viewInvoice.style.display = 'block';
      if (viewGatepass) viewGatepass.style.display = 'none';
    } else {
      if (tabInvoiceBtn) tabInvoiceBtn.classList.remove('active');
      if (tabGatepassBtn) tabGatepassBtn.classList.add('active');
      if (viewInvoice) viewInvoice.style.display = 'none';
      if (viewGatepass) viewGatepass.style.display = 'block';
    }
  }

  // Print or Save Tax Invoice as PDF
  function printInvoice() {
    window.print();
  }

  // Copy Exit Token for quick testing with Security Guard App
  function copyExitToken() {
    const tokenEl = document.getElementById('pass-token-text');
    if (!tokenEl) return;
    const token = tokenEl.textContent.trim();
    copySpecificOrderToken(token);
  }

  // Copy specific order token with toast feedback
  function copySpecificOrderToken(token) {
    if (!token) {
      showToast('No exit token found for this order.', 'error');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(() => {
        showToast('Exit token copied to clipboard! Ready to paste in Guard App.', 'success');
      }).catch(() => {
        showToast(`Token: ${token}`, 'info');
      });
    } else {
      showToast(`Token: ${token}`, 'info');
    }
  }

  // Render Order History Modal Cards & Lifetime Statistics
  function renderOrderHistoryList() {
    const totalOrdersEl = document.getElementById('history-total-orders');
    const totalSpendEl = document.getElementById('history-total-spend');
    const totalSavingsEl = document.getElementById('history-total-savings');
    const listEl = document.getElementById('order-history-list');

    const orders = AppState.orders || [];

    const totalSpend = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const totalSavings = orders.reduce((sum, o) => sum + Number(o.totalSavings || 0), 0);

    if (totalOrdersEl) totalOrdersEl.textContent = orders.length;
    if (totalSpendEl) totalSpendEl.textContent = `₹${totalSpend.toFixed(2)}`;
    if (totalSavingsEl) totalSavingsEl.textContent = `₹${totalSavings.toFixed(2)}`;

    if (!listEl) return;

    if (orders.length === 0) {
      listEl.innerHTML = `
        <div class="history-empty-state">
          <div style="font-size:2.8rem; margin-bottom:8px;">📦</div>
          <strong style="font-size:1.05rem; color:#fff; display:block; margin-bottom:4px;">No Order History Found</strong>
          <p style="color:var(--text-muted); font-size:0.84rem;">Scan products from the shelf and complete payment to start building your lifetime order history.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = orders.map((order, idx) => {
      const orderDate = new Date(order.createdAt || Date.now());
      const dateStr = orderDate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      const timeStr = orderDate.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const itemCount = order.itemCount || (order.items ? order.items.reduce((s, i) => s + (i.quantity || 1), 0) : 0);
      const paymentMethod = order.payment?.methodLabel || (order.payment?.method ? order.payment.method.toUpperCase() : 'UPI');

      const itemChips = Array.isArray(order.items)
        ? order.items.slice(0, 3).map(i => `<span class="history-item-chip">${i.name} ×${i.quantity}</span>`).join('') +
          (order.items.length > 3 ? `<span class="history-item-chip more">+${order.items.length - 3} more</span>` : '')
        : '';

      return `
        <div class="history-order-card">
          <div class="history-card-header">
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <strong class="history-order-num">${order.orderNumber}</strong>
                <span class="history-status-pill">● PAID</span>
                ${idx === 0 ? '<span class="history-latest-pill">LATEST</span>' : ''}
              </div>
              <div class="history-date-sub">📅 ${dateStr} • ⏱️ ${timeStr} • 📍 ${order.storeName || 'Smart Supermarket'}</div>
            </div>
            <div style="text-align:right;">
              <div class="history-card-total">₹${Number(order.totalAmount || 0).toFixed(2)}</div>
              ${order.totalSavings ? `<div class="history-savings-tag">Saved ₹${Number(order.totalSavings).toFixed(2)}</div>` : ''}
            </div>
          </div>

          <div class="history-items-summary-row">
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
              <span>🛒 <strong>${itemCount} items</strong></span> • <span>💳 <strong>${paymentMethod}</strong></span>
            </div>
            <div class="history-chips-container">${itemChips}</div>
          </div>

          <div class="history-card-actions">
            <button type="button" class="btn-primary history-action-btn" onclick="window.SmartShopper.viewPastOrder('${order.orderNumber}', 'invoice')">
              <span>🧾 Full Tax Invoice</span>
            </button>
            <button type="button" class="btn-secondary history-action-btn" onclick="window.SmartShopper.viewPastOrder('${order.orderNumber}', 'gatepass')">
              <span>🛡️ Exit QR Pass</span>
            </button>
            <button type="button" class="btn-secondary history-action-btn copy-btn" onclick="window.SmartShopper.copySpecificOrderToken('${order.exitVerification?.token || ''}')" title="Copy Guard Verification Token">
              <span>📋 Copy Token</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Open Order History Modal
  function openOrderHistoryModal() {
    renderOrderHistoryList();
    openModal('order-history-modal');
  }

  // View specific past order from history list
  function viewPastOrder(orderNumber, tab = 'invoice') {
    const order = (AppState.orders || []).find(o => o.orderNumber === orderNumber || o.orderId === orderNumber);
    if (!order) {
      showToast('Order not found in history.', 'error');
      return;
    }
    closeModal('order-history-modal');
    displayDigitalInvoiceAndExitPass(order);
    switchInvoiceTab(tab);
  }

  // ==========================================
  // SMART SHOPPING LIST & AISLE FINDER
  // ==========================================
  function loadShoppingList() {
    const saved = localStorage.getItem('smartscan_shopping_list');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) AppState.shoppingList = parsed;
      } catch (e) {}
    }
    updateShoppingListBadges();
  }

  function saveShoppingList() {
    localStorage.setItem('smartscan_shopping_list', JSON.stringify(AppState.shoppingList || []));
    updateShoppingListBadges();
    renderShoppingList();
    renderAisleMap();
  }

  function updateShoppingListBadges() {
    const count = AppState.shoppingList ? AppState.shoppingList.filter(i => !i.completed).length : 0;
    const hBadge = document.getElementById('header-list-badge');
    const sBadge = document.getElementById('session-list-badge');
    const lCount = document.getElementById('slist-count-label');
    if (hBadge) hBadge.textContent = count;
    if (sBadge) sBadge.textContent = count;
    if (lCount) lCount.textContent = (AppState.shoppingList || []).length;
  }

  function findCatalogMatch(name) {
    if (!name) return null;
    const q = name.toLowerCase().trim();
    return (AppState.catalog || []).find(p =>
      p.name.toLowerCase().includes(q) ||
      (p.category && p.category.toLowerCase().includes(q)) ||
      (p.brand && p.brand.toLowerCase().includes(q))
    );
  }

  function addShoppingListItem(name) {
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (!AppState.shoppingList) AppState.shoppingList = [];

    const matchedProduct = findCatalogMatch(cleanName);

    const newItem = {
      id: `list_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName,
      completed: false,
      matchedProduct: matchedProduct ? {
        barcode: matchedProduct.barcode,
        name: matchedProduct.name,
        sellingPrice: matchedProduct.sellingPrice,
        shelfLocation: matchedProduct.shelfLocation || 'General Aisle',
        category: matchedProduct.category
      } : null,
      createdAt: new Date().toISOString()
    };

    AppState.shoppingList.unshift(newItem);
    saveShoppingList();
    showToast(`Added "${cleanName}" to Shopping List`, 'success');
  }

  function toggleShoppingListItem(id) {
    const item = (AppState.shoppingList || []).find(i => i.id === id);
    if (item) {
      item.completed = !item.completed;
      saveShoppingList();
    }
  }

  function removeShoppingListItem(id) {
    AppState.shoppingList = (AppState.shoppingList || []).filter(i => i.id !== id);
    saveShoppingList();
  }

  function clearShoppingList() {
    AppState.shoppingList = [];
    saveShoppingList();
    showToast('Shopping list cleared.', 'info');
  }

  function addQuickListItem(name) {
    addShoppingListItem(name);
  }

  function switchListTab(tab) {
    const tabListBtn = document.getElementById('tab-btn-slist');
    const tabMapBtn = document.getElementById('tab-btn-smap');
    const viewList = document.getElementById('view-slist-checklist');
    const viewMap = document.getElementById('view-slist-map');

    if (tab === 'list') {
      tabListBtn?.classList.add('active');
      tabMapBtn?.classList.remove('active');
      if (viewList) viewList.style.display = 'block';
      if (viewMap) viewMap.style.display = 'none';
      renderShoppingList();
    } else {
      tabListBtn?.classList.remove('active');
      tabMapBtn?.classList.add('active');
      if (viewList) viewList.style.display = 'none';
      if (viewMap) viewMap.style.display = 'block';
      renderAisleMap();
    }
  }

  function renderShoppingList() {
    const container = document.getElementById('shopping-list-items-container');
    const totalEl = document.getElementById('slist-estimated-total');
    if (!container) return;

    const list = AppState.shoppingList || [];

    let estimatedTotal = 0;
    list.forEach(i => {
      if (i.matchedProduct) estimatedTotal += Number(i.matchedProduct.sellingPrice || 0);
    });

    if (totalEl) totalEl.textContent = `₹${estimatedTotal.toFixed(2)}`;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:28px 14px; color:var(--text-muted); font-size:0.85rem;">
          <div style="font-size:2.2rem; margin-bottom:6px;">📝</div>
          Your shopping list is empty. Type an item above or tap a Quick Add chip to see exact store aisle locations!
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => {
      const match = item.matchedProduct;
      const location = match ? match.shelfLocation : '📍 General Supermarket Shelf';
      const price = match ? `₹${Number(match.sellingPrice).toFixed(2)}` : '--';

      return `
        <div class="slist-item-row ${item.completed ? 'completed' : ''}">
          <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer;">
            <input type="checkbox" class="slist-check" ${item.completed ? 'checked' : ''} onchange="window.SmartShopper.toggleShoppingListItem('${item.id}')" />
            <div>
              <span class="slist-item-name ${item.completed ? 'strike' : ''}">${item.name}</span>
              ${match ? `<div style="font-size:0.75rem; color:#38bdf8; font-weight:600;">Match: ${match.name} (${price})</div>` : ''}
              <div class="slist-location-tag">📍 ${location}</div>
            </div>
          </label>
          <div style="display:flex; align-items:center; gap:8px;">
            ${match ? `
              <button type="button" class="btn-primary" style="padding:4px 10px; font-size:0.75rem;" onclick="window.SmartShopper.addListProductToCart('${match.barcode}')">
                + Cart
              </button>
            ` : ''}
            <button type="button" class="cart-remove-btn" onclick="window.SmartShopper.removeShoppingListItem('${item.id}')" title="Delete">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderAisleMap() {
    const list = AppState.shoppingList || [];
    const aisleCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const matchedLocations = [];

    list.forEach(item => {
      if (item.matchedProduct && item.matchedProduct.shelfLocation) {
        const loc = item.matchedProduct.shelfLocation.toLowerCase();
        let aisleNum = null;
        if (loc.includes('aisle 1')) aisleNum = 1;
        else if (loc.includes('aisle 2')) aisleNum = 2;
        else if (loc.includes('aisle 3')) aisleNum = 3;
        else if (loc.includes('aisle 4')) aisleNum = 4;
        else if (loc.includes('aisle 5')) aisleNum = 5;

        if (aisleNum) {
          aisleCounts[aisleNum]++;
          matchedLocations.push(`${item.name} → Aisle ${aisleNum}`);
        }
      }
    });

    // Update map blocks
    for (let a = 1; a <= 5; a++) {
      const block = document.getElementById(`map-aisle-${a}`);
      const pin = document.getElementById(`pin-aisle-${a}`);
      const count = aisleCounts[a];

      if (block) {
        if (count > 0) {
          block.classList.add('active-target');
        } else {
          block.classList.remove('active-target');
        }
      }

      if (pin) {
        if (count > 0) {
          pin.style.display = 'inline-flex';
          pin.querySelector('span').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
        } else {
          pin.style.display = 'none';
        }
      }
    }

    const summaryEl = document.getElementById('map-matched-locations-summary');
    if (summaryEl) {
      if (matchedLocations.length > 0) {
        summaryEl.innerHTML = `<strong>Active Items Located on Floor:</strong> ${matchedLocations.join(' • ')}`;
      } else {
        summaryEl.innerHTML = `<em>Add items to your list to view personalized Aisle route guidance on the store map.</em>`;
      }
    }
  }

  function openShoppingListModal() {
    loadShoppingList();
    renderShoppingList();
    renderAisleMap();
    openModal('shopping-list-modal');
  }

  function addListProductToCart(barcode) {
    const product = (AppState.catalog || []).find(p => p.barcode === barcode);
    if (product) {
      addToCart(product, 1);
      showToast(`Added ${product.name} to cart!`, 'success');
    }
  }

  // ==========================================
  // REAL-TIME SMS & WHATSAPP BILL NOTIFICATIONS
  // ==========================================
  function openNotificationDialog(order) {
    const targetOrder = order || AppState.lastOrder || (AppState.orders && AppState.orders.length > 0 ? AppState.orders[0] : null);
    if (!targetOrder) {
      showToast('No active bill found to dispatch.', 'error');
      return;
    }
    AppState.currentAlertOrder = targetOrder;
    AppState.activeNotifChannel = 'both';

    const phoneInput = document.getElementById('notif-phone-input');
    if (phoneInput) {
      phoneInput.value = targetOrder.customerPhone || (AppState.user ? AppState.user.phone : '9876543210');
    }

    updateNotificationPreview();
    openModal('notification-modal');
  }

  function setNotifChannel(channel) {
    AppState.activeNotifChannel = channel;
    const btnBoth = document.getElementById('notif-ch-both');
    const btnWa = document.getElementById('notif-ch-whatsapp');
    const btnSms = document.getElementById('notif-ch-sms');
    const titleEl = document.getElementById('preview-app-title');

    [btnBoth, btnWa, btnSms].forEach(b => b?.classList.remove('active'));

    if (channel === 'both') {
      btnBoth?.classList.add('active');
      if (titleEl) titleEl.textContent = '🟢 WhatsApp & 📨 SMS Dual Delivery Preview';
    } else if (channel === 'whatsapp') {
      btnWa?.classList.add('active');
      if (titleEl) titleEl.textContent = '🟢 WhatsApp Business Message Preview';
    } else {
      btnSms?.classList.add('active');
      if (titleEl) titleEl.textContent = '📨 Standard SMS Alert Preview';
    }

    updateNotificationPreview();
  }

  function updateNotificationPreview() {
    const order = AppState.currentAlertOrder;
    if (!order) return;

    const chatTextEl = document.getElementById('notif-chat-preview-text');
    if (!chatTextEl) return;

    const store = order.storeName || 'Smart Supermarket • Central Hub';
    const num = order.orderNumber;
    const name = order.customerName || 'Valued Shopper';
    const amount = Number(order.totalAmount || 0).toFixed(2);
    const savings = Number(order.totalSavings || 0).toFixed(2);
    const count = order.itemCount || (order.items ? order.items.length : 1);
    const token = order.exitVerification?.token || `SMARTSCAN-EXIT-${num}`;

    if (AppState.activeNotifChannel === 'sms') {
      chatTextEl.innerHTML = `
        <div style="font-family:monospace; font-size:0.8rem; line-height:1.4;">
          <strong>[${store}]</strong> Order #${num} Confirmed! Paid ₹${amount} for ${count} items (Saved ₹${savings}).<br><br>
          🛡️ Exit Pass: <code>${token}</code><br>
          🔗 View live bill: <span style="color:#38bdf8;">http://localhost:3001/?order=${num}</span>
        </div>
      `;
    } else {
      chatTextEl.innerHTML = `
        <div style="font-size:0.82rem; line-height:1.5;">
          <strong style="color:#22c55e; font-size:0.95rem;">⚡ ${store}</strong><br><br>
          Hello <strong>${name}</strong>,<br>
          Your electronic tax invoice for <strong>Order #${num}</strong> has been generated successfully.<br><br>
          🛒 <strong>Items Billed:</strong> ${count} items<br>
          💰 <strong>Grand Total Paid:</strong> ₹${amount}<br>
          🎉 <strong>Total Savings:</strong> ₹${savings}<br><br>
          🛡️ <strong>Exit Gate Pass Token:</strong><br>
          <code style="background:rgba(0,0,0,0.4); padding:2px 6px; border-radius:4px; display:block; margin:4px 0; word-break:break-all; color:#38bdf8;">${token}</code><br>
          🔗 <span style="color:#38bdf8; text-decoration:underline;">http://localhost:3001/?order=${num}</span><br><br>
          <span style="font-size:0.75rem; color:#94a3b8;">✓ Delivered to your verified mobile number</span>
        </div>
      `;
    }
  }

  async function dispatchNotification() {
    const order = AppState.currentAlertOrder;
    if (!order) return;

    const phoneInput = document.getElementById('notif-phone-input');
    const phone = phoneInput ? phoneInput.value.trim() : order.customerPhone;
    const channel = AppState.activeNotifChannel || 'both';

    try {
      const res = await fetch(`${API_BASE}/api/notifications/send-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: order.orderNumber,
          phone,
          channel
        })
      });

      const data = await res.json();
      if (data.success) {
        soundPlayer.playSuccess();
        closeModal('notification-modal');
        showToast(`📲 Digital bill dispatched via ${channel.toUpperCase()} to +91 ${phone}!`, 'success');
      } else {
        showToast(data.error || 'Failed to dispatch alert.', 'error');
      }
    } catch (err) {
      soundPlayer.playSuccess();
      closeModal('notification-modal');
      showToast(`📲 Simulated ${channel.toUpperCase()} bill alert delivered to +91 ${phone}!`, 'success');
    }
  }

  // Finish shopping trip & close modal
  function finishShopping() {
    closeModal('exit-pass-modal');
    showToast('Shopping trip completed! Have a great day.', 'success');
  }

  // Modal helpers
  function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('open');
  }

  function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('open');
  }

  // Setup Event Listeners
  function bindEvents() {
    // Auth Tab Switch
    const loginTabBtn = document.getElementById('auth-tab-login');
    const registerTabBtn = document.getElementById('auth-tab-register');
    const guestTabBtn = document.getElementById('auth-tab-guest');
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const guestForm = document.getElementById('form-guest');

    function switchAuthTab(tab) {
      [loginTabBtn, registerTabBtn, guestTabBtn].forEach(b => b && b.classList.remove('active'));
      [loginForm, registerForm, guestForm].forEach(f => f && (f.style.display = 'none'));

      if (tab === 'login') {
        if (loginTabBtn) loginTabBtn.classList.add('active');
        if (loginForm) loginForm.style.display = 'block';
      } else if (tab === 'register') {
        if (registerTabBtn) registerTabBtn.classList.add('active');
        if (registerForm) registerForm.style.display = 'block';
      } else if (tab === 'guest') {
        if (guestTabBtn) guestTabBtn.classList.add('active');
        if (guestForm) guestForm.style.display = 'block';
      }
    }

    if (loginTabBtn) loginTabBtn.addEventListener('click', () => switchAuthTab('login'));
    if (registerTabBtn) registerTabBtn.addEventListener('click', () => switchAuthTab('register'));
    if (guestTabBtn) guestTabBtn.addEventListener('click', () => switchAuthTab('guest'));

    // Login Form Submit
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('login-phone').value.trim();
        const password = document.getElementById('login-password').value;

        try {
          const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
          });
          const data = await res.json();
          if (data.success && data.data) {
            AppState.user = data.data.user;
            AppState.sessionToken = data.data.sessionToken;
            localStorage.setItem('smartscan_shopper_session', JSON.stringify(data.data));
            showShoppingView();
            loadOrderHistory();
            showToast(`Welcome back, ${data.data.user.fullName}!`, 'success');
            return;
          } else {
            showToast(data.error || 'Invalid credentials. Use Demo Phone: 9876543210, Password: shopper123', 'error');
            return;
          }
        } catch (err) {
          // Direct fallback validation against .env configured credentials for standalone/static preview
          if ((phone === '9876543210' && password === 'shopper123') || (phone === 'alex' && password === 'shopper123')) {
            const userData = {
              sessionToken: `SHOPPER-${Date.now()}`,
              user: {
                fullName: 'Alex Sharma',
                phone: phone,
                role: 'shopper',
                storeId: 'STORE_104',
                storeName: 'Smart Supermarket'
              }
            };
            AppState.user = userData.user;
            AppState.sessionToken = userData.sessionToken;
            localStorage.setItem('smartscan_shopper_session', JSON.stringify(userData));
            showShoppingView();
            loadOrderHistory();
            showToast('Welcome back, Alex Sharma!', 'success');
          } else {
            showToast('Invalid credentials! Demo Phone: 9876543210, Password: shopper123', 'error');
          }
        }
      });
    }

    // Register Form Submit
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = (document.getElementById('reg-name')?.value || '').trim();
        const phone = (document.getElementById('reg-phone')?.value || '').trim();
        const password = (document.getElementById('reg-password')?.value || '');

        if (!fullName || !phone || !password) {
          showToast('Please fill all registration fields.', 'error');
          return;
        }

        if (!window.location.protocol.startsWith('file')) {
          try {
            const res = await fetch(`${API_BASE}/api/auth/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fullName, phone, password })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.data) {
                AppState.user = data.data.user;
                AppState.sessionToken = data.data.sessionToken;
                localStorage.setItem('smartscan_shopper_session', JSON.stringify(data.data));
                showShoppingView();
                loadOrderHistory();
                showToast(`Account created! Welcome, ${data.data.user.fullName}.`, 'success');
                return;
              }
            }
          } catch (err) {
            console.warn('Backend server note:', err.message);
          }
        }

        const userData = {
          sessionToken: `SHOPPER-${Date.now()}`,
          user: {
            fullName: fullName || 'New Shopper',
            phone: phone,
            role: 'shopper',
            storeId: 'STORE_104',
            storeName: 'Smart Supermarket'
          }
        };
        AppState.user = userData.user;
        AppState.sessionToken = userData.sessionToken;
        localStorage.setItem('smartscan_shopper_session', JSON.stringify(userData));
        showShoppingView();
        loadOrderHistory();
        showToast(`Account created! Welcome, ${fullName}.`, 'success');
      });
    }

    // Guest Form Submit
    if (guestForm) {
      guestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = (document.getElementById('guest-name')?.value || '').trim() || 'Guest Shopper';
        const phoneNumber = (document.getElementById('guest-phone')?.value || '').trim() || '9876543210';

        if (!window.location.protocol.startsWith('file')) {
          try {
            const res = await fetch(`${API_BASE}/api/auth/guest-session`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fullName, phoneNumber })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success && data.data) {
                AppState.user = data.data.user;
                AppState.sessionToken = data.data.sessionToken;
                localStorage.setItem('smartscan_shopper_session', JSON.stringify(data.data));
                showShoppingView();
                loadOrderHistory();
                showToast('Guest shopping session started.', 'success');
                return;
              }
            }
          } catch (err) {
            console.warn('Backend server note:', err.message);
          }
        }

        const userData = {
          sessionToken: `GUEST-${Date.now()}`,
          user: {
            fullName: fullName,
            phone: phoneNumber,
            role: 'shopper',
            storeId: 'STORE_104',
            storeName: 'Smart Supermarket'
          }
        };
        AppState.user = userData.user;
        AppState.sessionToken = userData.sessionToken;
        localStorage.setItem('smartscan_shopper_session', JSON.stringify(userData));
        showShoppingView();
        loadOrderHistory();
        showToast('Guest shopping session started.', 'success');
      });
    }

    // Logout
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('smartscan_shopper_session');
        AppState.user = null;
        AppState.sessionToken = null;
        AppState.cart = [];
        showAuthView();
        showToast('Logged out of shopping session.', 'info');
      });
    }

    // Scanner Controls
    const torchBtn = document.getElementById('scanner-torch-btn');
    if (torchBtn) {
      torchBtn.addEventListener('click', async () => {
        if (AppState.scannerInstance) {
          const on = await AppState.scannerInstance.toggleTorch();
          torchBtn.style.background = on ? 'var(--primary)' : 'rgba(0,0,0,0.7)';
        }
      });
    }

    const flipBtn = document.getElementById('scanner-flip-btn');
    if (flipBtn) {
      flipBtn.addEventListener('click', () => {
        if (AppState.scannerInstance) AppState.scannerInstance.flipCamera();
      });
    }

    const fileInput = document.getElementById('barcode-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0] && AppState.scannerInstance) {
          AppState.scannerInstance.scanFile(e.target.files[0]);
        }
      });
    }

    const manualForm = document.getElementById('manual-barcode-form');
    if (manualForm) {
      manualForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('manual-barcode-input');
        if (input && input.value.trim()) {
          handleBarcodeScanned(input.value.trim());
          input.value = '';
        }
      });
    }

    // Detected Product Actions
    const detCloseBtn = document.getElementById('det-close-btn');
    if (detCloseBtn) detCloseBtn.addEventListener('click', hideDetectedProduct);

    const detMinus = document.getElementById('det-qty-minus');
    const detPlus = document.getElementById('det-qty-plus');
    const detQtyVal = document.getElementById('det-qty-val');
    const detAddBtn = document.getElementById('det-add-btn');

    if (detMinus) {
      detMinus.addEventListener('click', () => {
        if (AppState.detectedProduct && AppState.detectedProduct.selectedQty > 1) {
          AppState.detectedProduct.selectedQty--;
          if (detQtyVal) detQtyVal.textContent = AppState.detectedProduct.selectedQty;
        }
      });
    }

    if (detPlus) {
      detPlus.addEventListener('click', () => {
        if (AppState.detectedProduct) {
          AppState.detectedProduct.selectedQty++;
          if (detQtyVal) detQtyVal.textContent = AppState.detectedProduct.selectedQty;
        }
      });
    }

    if (detAddBtn) {
      detAddBtn.addEventListener('click', () => {
        if (AppState.detectedProduct) {
          addToCart(AppState.detectedProduct, AppState.detectedProduct.selectedQty || 1);
        }
      });
    }

    // Coupon
    const couponBtn = document.getElementById('apply-coupon-btn');
    if (couponBtn) couponBtn.addEventListener('click', applyCoupon);

    // Checkout modal openers & payment tabs
    const openCheckoutBtn = document.getElementById('open-checkout-modal-btn');
    if (openCheckoutBtn) {
      openCheckoutBtn.addEventListener('click', () => openModal('payment-modal'));
    }

    const payTabs = document.querySelectorAll('.pay-tab');
    payTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        payTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const method = tab.getAttribute('data-method');

        const upiView = document.getElementById('pay-view-upi');
        const cardView = document.getElementById('pay-view-card');
        const counterView = document.getElementById('pay-view-counter');

        if (upiView) upiView.style.display = method === 'upi' ? 'block' : 'none';
        if (cardView) cardView.style.display = method === 'card' ? 'block' : 'none';
        if (counterView) counterView.style.display = method === 'counter' ? 'block' : 'none';
      });
    });

    // Payment Confirm Buttons
    const btnConfirmUpi = document.getElementById('btn-confirm-upi');
    if (btnConfirmUpi) btnConfirmUpi.addEventListener('click', () => executeCheckout('upi'));

    const btnConfirmCard = document.getElementById('btn-confirm-card');
    if (btnConfirmCard) btnConfirmCard.addEventListener('click', () => executeCheckout('card'));

    const btnConfirmCounter = document.getElementById('btn-confirm-counter');
    if (btnConfirmCounter) btnConfirmCounter.addEventListener('click', () => executeCheckout('counter'));
  }

  // Public Interface
  window.SmartShopper = {
    updateQty: updateCartItemQty,
    openModal,
    closeModal,
    showToast,
    switchInvoiceTab,
    printInvoice,
    copyExitToken,
    finishShopping,
    openOrderHistoryModal,
    viewPastOrder,
    copySpecificOrderToken,
    loadOrderHistory,
    showLastInvoice: () => {
      if (AppState.orders && AppState.orders.length > 0) {
        displayDigitalInvoiceAndExitPass(AppState.orders[0]);
      } else if (AppState.lastOrder) {
        displayDigitalInvoiceAndExitPass(AppState.lastOrder);
      } else {
        const saved = localStorage.getItem('smartscan_last_order');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            AppState.lastOrder = parsed;
            displayDigitalInvoiceAndExitPass(parsed);
            return;
          } catch (e) {}
        }
        showToast('No recent invoice found.', 'info');
      }
    }
  };

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadInitialData();
    restoreSession();
    loadOrderHistory();
  });
})();
