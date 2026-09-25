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
    serverConfig: null
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
      showToast('Cart is empty', 'error');
      return;
    }

    try {
      const payload = {
        customerName: AppState.user ? AppState.user.fullName : 'Shopper',
        customerPhone: AppState.user ? AppState.user.phone : '9876543210',
        cartItems: AppState.cart,
        paymentMethod,
        appliedDiscount: AppState.couponDiscount,
        sessionToken: AppState.sessionToken
      };

      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.success && data.data) {
        soundPlayer.playSuccess();
        closeModal('payment-modal');
        displayExitPass(data.data);
        AppState.cart = [];
        AppState.appliedCoupon = null;
        AppState.couponDiscount = 0;
        renderCart();
        showToast('Payment successful! Your Exit Pass is ready.', 'success');
      } else {
        showToast(data.error || 'Checkout failed', 'error');
      }
    } catch (err) {
      showToast('Error processing checkout. Please check server.', 'error');
    }
  }

  // Display Exit Pass Modal
  function displayExitPass(order) {
    const orderNumEl = document.getElementById('pass-order-num');
    const qrBox = document.getElementById('pass-qr-box');
    const dateEl = document.getElementById('pass-date');
    const totalEl = document.getElementById('pass-total');
    const itemsCountEl = document.getElementById('pass-items-count');
    const itemsSummary = document.getElementById('pass-items-summary');

    if (orderNumEl) orderNumEl.textContent = order.orderNumber;
    if (totalEl) totalEl.textContent = `₹${order.totalAmount.toFixed(2)}`;
    if (itemsCountEl) itemsCountEl.textContent = `${order.itemCount} items`;
    if (dateEl) dateEl.textContent = new Date(order.createdAt).toLocaleTimeString();

    if (qrBox && order.exitVerification && order.exitVerification.token) {
      qrBox.innerHTML = renderSvgQR(order.exitVerification.token);
    }

    if (itemsSummary && order.items) {
      itemsSummary.innerHTML = order.items.map(i => `
        <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#e2e8f0; margin-bottom:4px;">
          <span>${i.name} (×${i.quantity})</span>
          <span>₹${i.lineTotal.toFixed(2)}</span>
        </div>
      `).join('');
    }

    openModal('exit-pass-modal');
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
    showToast
  };

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadInitialData();
    restoreSession();
  });
})();
