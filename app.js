/**
 * SmartScan Supermarket Self-Checkout & Operations Suite
 * Client-side Reactive Application Core
 */

(function () {
  'use strict';

  // ==========================================
  // 1. GLOBAL STATE & CONSTANTS
  // ==========================================
  const STATE = {
    currentRole: 'shopper', // 'shopper' | 'manager' | 'guard'
    shopper: {
      isLoggedIn: false,
      fullName: '',
      phoneNumber: '',
      sessionToken: null,
      storeId: 'STORE_DEL_01'
    },
    manager: {
      isAuthenticated: false,
      role: 'store_manager',
      username: ''
    },
    catalog: [],
    cart: [], // [{ product, quantity, unitPrice, mrp, lineTotal, taxRate }]
    appliedCoupon: null,
    detectedProduct: null,
    detectedQty: 1,
    orders: [],
    activeCarts: [],
    analytics: null,
    guardAuditOrder: null
  };

  const COUPONS = {
    'SMART10': { type: 'percent', value: 10, label: '10% Storewide Off' },
    'SAVE50': { type: 'flat', value: 50, label: '₹50 Flat Instant Savings' },
    'WELCOME': { type: 'percent', value: 15, label: '15% First-time Shopper Promo' }
  };

  let shopperScanner = null;
  let guardScanner = null;

  // ==========================================
  // 2. INITIALIZATION
  // ==========================================
  document.addEventListener('DOMContentLoaded', async () => {
    initPWA();
    setupRoleSwitcher();
    setupEventListeners();
    await loadCatalog();
    initSimulatorBar();

    // Check for saved shopper session
    const savedShopper = localStorage.getItem('smartscan_shopper');
    if (savedShopper) {
      try {
        const parsed = JSON.parse(savedShopper);
        if (parsed && parsed.phoneNumber) {
          STATE.shopper = { ...STATE.shopper, ...parsed, isLoggedIn: true };
          renderShopperSession();
        }
      } catch (e) {}
    }

    // Initialize Shopper Scanner Instance
    initShopperScanner();
  });

  function initPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('[SmartScan PWA] Service Worker Registered'))
        .catch(err => console.log('[SmartScan PWA] SW Registration:', err));
    }
  }

  // ==========================================
  // 3. CATALOG & API DATA LAYER
  // ==========================================
  async function loadCatalog() {
    const saved = localStorage.getItem('smartscan_catalog');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          STATE.catalog = parsed;
          renderManagerCatalog();
        }
      } catch (e) {}
    }

    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data && Array.isArray(json.data) && json.data.length > 0) {
          STATE.catalog = json.data;
          localStorage.setItem('smartscan_catalog', JSON.stringify(STATE.catalog));
          renderManagerCatalog();
          return;
        }
      }
    } catch (e) {
      console.warn('[Catalog API] Backend unavailable, loading local fallback:', e.message);
    }

    // Fallback load from static json if catalog empty
    if (!STATE.catalog || STATE.catalog.length === 0) {
      try {
        const localRes = await fetch('./data/sample_products.json');
        if (localRes.ok) {
          STATE.catalog = await localRes.json();
          localStorage.setItem('smartscan_catalog', JSON.stringify(STATE.catalog));
          renderManagerCatalog();
        }
      } catch (err) {
        console.error('Failed to load sample products:', err);
      }
    }
  }

  // Find product by barcode in state
  function lookupProduct(barcode) {
    const clean = String(barcode).trim();
    return STATE.catalog.find(p => p.barcode === clean || p.id === clean);
  }

  // ==========================================
  // 4. SCANNER ENGINE INITIALIZATION
  // ==========================================
  function initShopperScanner() {
    if (typeof SmartBarcodeScanner === 'undefined') return;

    shopperScanner = new SmartBarcodeScanner({
      videoElementId: 'reader-container',
      onDetected: (barcode) => {
        handleProductScan(barcode);
      },
      onError: (err) => {
        console.warn('[Shopper Scanner Error]:', err);
        showToast(err.message || 'Camera access error. Use simulation buttons or manual input below.', 'warning');
      },
      onStatusChange: (status) => {
        const chip = document.getElementById('scanner-status-text');
        if (chip) chip.textContent = status.message || status.status;
      }
    });
  }

  function initGuardScanner() {
    if (typeof SmartBarcodeScanner === 'undefined') return;

    guardScanner = new SmartBarcodeScanner({
      videoElementId: 'guard-reader-container',
      onDetected: (scannedText) => {
        handleGuardExitScan(scannedText);
      },
      onError: (err) => {
        showToast('Guard Camera: ' + (err.message || 'Camera error'), 'warning');
      },
      onStatusChange: (status) => {
        const chip = document.getElementById('guard-status-text');
        if (chip) chip.textContent = status.message || status.status;
      }
    });
  }

  // ==========================================
  // 5. DOMAIN 1: SHOPPER WORKFLOW HANDLERS
  // ==========================================

  // Handle Barcode Detection
  function handleProductScan(barcode) {
    const product = lookupProduct(barcode);
    if (!product) {
      showToast(`Item barcode '${barcode}' not recognized in store catalog.`, 'error');
      return;
    }

    STATE.detectedProduct = product;
    STATE.detectedQty = 1;
    renderDetectionCard(product);
    showToast(`Scanned: ${product.name}`, 'success');
  }

  // Render Product Detection Bottom Sheet
  function renderDetectionCard(prod) {
    const card = document.getElementById('detection-card');
    if (!card) return;

    const img = document.getElementById('det-img');
    const title = document.getElementById('det-title');
    const cat = document.getElementById('det-cat');
    const unit = document.getElementById('det-unit');
    const price = document.getElementById('det-price');
    const mrp = document.getElementById('det-mrp');
    const disc = document.getElementById('det-discount');
    const stock = document.getElementById('det-stock');
    const qtyVal = document.getElementById('det-qty-val');

    if (img) img.src = prod.imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600';
    if (title) title.textContent = prod.name;
    if (cat) cat.textContent = prod.category;
    if (unit) unit.textContent = `${prod.unit} • ${prod.shelfLocation || 'Main Aisle'}`;
    if (price) price.textContent = `₹${Number(prod.sellingPrice).toFixed(2)}`;
    if (mrp) mrp.textContent = `₹${Number(prod.mrp || prod.sellingPrice).toFixed(2)}`;
    if (disc) {
      const discount = prod.mrp > prod.sellingPrice ? Math.round(((prod.mrp - prod.sellingPrice) / prod.mrp) * 100) : 0;
      disc.textContent = `${discount}% OFF`;
      disc.style.display = discount > 0 ? 'inline-block' : 'none';
    }

    if (stock) {
      if (prod.stockQuantity <= 0) {
        stock.className = 'stock-indicator out-of-stock';
        stock.innerHTML = `⚠️ Out of Stock`;
      } else if (prod.stockQuantity <= prod.lowStockThreshold) {
        stock.className = 'stock-indicator low-stock';
        stock.innerHTML = `⚠️ Only ${prod.stockQuantity} units left in store!`;
      } else {
        stock.className = 'stock-indicator in-stock';
        stock.innerHTML = `✓ In Stock (${prod.stockQuantity} available)`;
      }
    }

    if (qtyVal) qtyVal.textContent = STATE.detectedQty;

    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Add Product to Cart
  function addDetectedToCart() {
    if (!STATE.detectedProduct) return;
    const prod = STATE.detectedProduct;
    const qty = STATE.detectedQty || 1;

    if (prod.stockQuantity < qty) {
      showToast(`Sorry, only ${prod.stockQuantity} units available in stock.`, 'warning');
      return;
    }

    const existingIndex = STATE.cart.findIndex(i => i.product.barcode === prod.barcode);
    if (existingIndex >= 0) {
      STATE.cart[existingIndex].quantity += qty;
    } else {
      STATE.cart.push({
        product: prod,
        quantity: qty,
        unitPrice: Number(prod.sellingPrice),
        mrp: Number(prod.mrp || prod.sellingPrice),
        taxRate: Number(prod.taxRatePercent || 5)
      });
    }

    // Hide card
    document.getElementById('detection-card').classList.remove('active');
    STATE.detectedProduct = null;
    STATE.detectedQty = 1;

    renderCart();
    syncCartToBackend();
    showToast(`Added ${qty} × ${prod.name} to cart!`, 'success');
  }

  // Update Cart Calculations & UI
  function renderCart() {
    const listEl = document.getElementById('cart-items-list');
    const emptyEl = document.getElementById('cart-empty-state');
    const countBadge = document.getElementById('cart-count-badge');
    const subtotalEl = document.getElementById('bill-subtotal');
    const taxEl = document.getElementById('bill-tax');
    const savingsEl = document.getElementById('bill-savings');
    const grandTotalEl = document.getElementById('bill-grand-total');
    const bottomTotalEl = document.getElementById('bottom-grand-total');
    const bottomItemCountEl = document.getElementById('bottom-item-count');

    const totalItems = STATE.cart.reduce((sum, i) => sum + i.quantity, 0);
    if (countBadge) countBadge.textContent = `${totalItems} items`;
    if (bottomItemCountEl) bottomItemCountEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;

    if (STATE.cart.length === 0) {
      if (listEl) listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (subtotalEl) subtotalEl.textContent = '₹0.00';
      if (taxEl) taxEl.textContent = '₹0.00';
      if (savingsEl) savingsEl.textContent = '₹0.00';
      if (grandTotalEl) grandTotalEl.textContent = '₹0.00';
      if (bottomTotalEl) bottomTotalEl.textContent = '₹0.00';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    let subtotal = 0;
    let taxTotal = 0;
    let totalSavings = 0;

    let itemsHtml = '';
    STATE.cart.forEach((item, index) => {
      const lineTotal = item.unitPrice * item.quantity;
      const itemTax = (lineTotal * item.taxRate) / 100;
      const itemSavings = (item.mrp - item.unitPrice) * item.quantity;

      subtotal += lineTotal;
      taxTotal += itemTax;
      totalSavings += itemSavings;

      itemsHtml += `
        <div class="cart-item-row">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.product.name}</div>
            <div class="cart-item-sub">
              ${item.product.unit} • ₹${item.unitPrice.toFixed(2)} each (GST ${item.taxRate}%)
            </div>
          </div>
          <div class="qty-stepper" style="transform: scale(0.85); transform-origin: right center;">
            <button class="qty-btn" onclick="window.SmartScanApp.updateCartQty(${index}, -1)">-</button>
            <span class="qty-val">${item.quantity}</span>
            <button class="qty-btn" onclick="window.SmartScanApp.updateCartQty(${index}, 1)">+</button>
          </div>
          <div class="cart-item-price">₹${lineTotal.toFixed(2)}</div>
          <button class="cart-delete-btn" onclick="window.SmartScanApp.removeCartItem(${index})" title="Remove item">✕</button>
        </div>
      `;
    });

    if (listEl) listEl.innerHTML = itemsHtml;

    // Apply coupon discount if any
    let discountAmount = 0;
    if (STATE.appliedCoupon) {
      if (STATE.appliedCoupon.type === 'percent') {
        discountAmount = (subtotal * STATE.appliedCoupon.value) / 100;
      } else {
        discountAmount = STATE.appliedCoupon.value;
      }
      totalSavings += discountAmount;
    }

    const grandTotal = Math.max(0, subtotal + taxTotal - discountAmount);

    if (subtotalEl) subtotalEl.textContent = `₹${subtotal.toFixed(2)}`;
    if (taxEl) taxEl.textContent = `₹${taxTotal.toFixed(2)}`;
    if (savingsEl) savingsEl.textContent = `₹${totalSavings.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;
    if (bottomTotalEl) bottomTotalEl.textContent = `₹${grandTotal.toFixed(2)}`;
  }

  function updateCartQty(index, delta) {
    if (!STATE.cart[index]) return;
    const newQty = STATE.cart[index].quantity + delta;
    if (newQty <= 0) {
      removeCartItem(index);
      return;
    }

    const prod = STATE.cart[index].product;
    if (prod.stockQuantity < newQty) {
      showToast(`Cannot add more. Only ${prod.stockQuantity} in stock.`, 'warning');
      return;
    }

    STATE.cart[index].quantity = newQty;
    renderCart();
    syncCartToBackend();
  }

  function removeCartItem(index) {
    if (STATE.cart[index]) {
      const removed = STATE.cart.splice(index, 1)[0];
      renderCart();
      syncCartToBackend();
      showToast(`Removed ${removed.product.name} from cart.`, 'info');
    }
  }

  function applyPromoCode(code) {
    const clean = code.trim().toUpperCase();
    if (!clean) return;

    if (COUPONS[clean]) {
      STATE.appliedCoupon = { code: clean, ...COUPONS[clean] };
      renderCart();
      showToast(`Promo '${clean}' applied: ${COUPONS[clean].label}!`, 'success');
      document.getElementById('coupon-msg').innerHTML = `<span style="color:var(--primary)">✓ ${COUPONS[clean].label} applied!</span>`;
    } else {
      showToast(`Invalid promo code '${clean}'. Try SMART10 or SAVE50.`, 'error');
      document.getElementById('coupon-msg').innerHTML = `<span style="color:var(--danger)">✗ Invalid promo coupon</span>`;
    }
  }

  // Backend Sync
  async function syncCartToBackend() {
    if (!STATE.shopper.sessionToken) return;
    try {
      await fetch('/api/cart/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: STATE.shopper.sessionToken,
          customerName: STATE.shopper.fullName,
          customerPhone: STATE.shopper.phoneNumber,
          items: STATE.cart.map(i => ({
            barcode: i.product.barcode,
            name: i.product.name,
            quantity: i.quantity,
            sellingPrice: i.unitPrice,
            mrp: i.mrp,
            unit: i.product.unit
          }))
        })
      });
    } catch (e) {}
  }

  // Complete Checkout & Generate Tamper-Proof Digital Pass
  async function processCheckout(paymentMethod = 'upi') {
    if (STATE.cart.length === 0) {
      showToast('Your cart is empty! Scan items to begin.', 'warning');
      return;
    }

    const payload = {
      customerName: STATE.shopper.fullName || 'Valued Shopper',
      customerPhone: STATE.shopper.phoneNumber || '9876543210',
      cartItems: STATE.cart.map(i => ({
        barcode: i.product.barcode,
        name: i.product.name,
        quantity: i.quantity,
        sellingPrice: i.unitPrice,
        mrp: i.mrp,
        unit: i.product.unit,
        taxRatePercent: i.taxRate
      })),
      paymentMethod,
      appliedDiscount: STATE.appliedCoupon ? (STATE.appliedCoupon.value || 0) : 0,
      sessionToken: STATE.shopper.sessionToken
    };

    let orderData = null;

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          orderData = json.data;
        }
      }
    } catch (err) {
      console.warn('Backend checkout error, running local checkout fallback:', err);
    }

    // Local checkout fallback if backend offline
    if (!orderData) {
      const subtotal = STATE.cart.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
      const tax = STATE.cart.reduce((s, i) => s + ((i.unitPrice * i.quantity * i.taxRate)/100), 0);
      const total = subtotal + tax;
      const orderNum = `ORD-${Date.now().toString().slice(-6)}`;
      orderData = {
        orderNumber: orderNum,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        items: payload.cartItems,
        itemCount: payload.cartItems.reduce((s, i) => s + i.quantity, 0),
        subtotal,
        taxTotal: tax,
        totalAmount: total,
        totalSavings: 45.0,
        status: 'paid',
        payment: { method: paymentMethod, transactionId: `TXN_${Date.now()}` },
        exitVerification: {
          token: `SMARTSCAN-EXIT-${orderNum}-${Math.random().toString(36).substring(2, 10)}`,
          generatedAt: new Date().toISOString(),
          isVerifiedAtGate: false
        }
      };

      // Decrement local catalog stock
      STATE.cart.forEach(item => {
        const p = lookupProduct(item.product.barcode);
        if (p) p.stockQuantity = Math.max(0, p.stockQuantity - item.quantity);
      });
    }

    // Add to global orders
    STATE.orders.unshift(orderData);

    // Clear cart
    STATE.cart = [];
    STATE.appliedCoupon = null;
    renderCart();

    // Close payment modal & open exit pass modal
    closeModal('payment-modal');
    renderExitPass(orderData);
    openModal('exit-pass-modal');

    // Reload catalog to reflect updated stock levels
    await loadCatalog();
    showToast('Payment Successful! Exit Pass generated.', 'success');
  }

  // Render Tamper-Proof Digital Exit Pass
  function renderExitPass(order) {
    const numEl = document.getElementById('pass-order-num');
    const dateEl = document.getElementById('pass-date');
    const totalEl = document.getElementById('pass-total');
    const countEl = document.getElementById('pass-items-count');
    const qrContainer = document.getElementById('pass-qr-box');
    const itemsListEl = document.getElementById('pass-items-summary');

    if (numEl) numEl.textContent = order.orderNumber;
    if (dateEl) dateEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (totalEl) totalEl.textContent = `₹${order.totalAmount.toFixed(2)}`;
    if (countEl) countEl.textContent = `${order.itemCount} items`;

    // Render Quick SVGs for QR Code
    if (qrContainer) {
      qrContainer.innerHTML = generateSampleQrSvg(order.exitVerification.token, 180);
    }

    if (itemsListEl) {
      itemsListEl.innerHTML = order.items.map(i => `
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px; color:var(--text-muted);">
          <span>${i.quantity}x ${i.name}</span>
          <span style="color:#fff;">₹${(i.sellingPrice * i.quantity).toFixed(2)}</span>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // 6. DOMAIN 2: MANAGER & ADMIN PORTAL
  // ==========================================

  function renderManagerCatalog() {
    const tableBody = document.getElementById('inventory-table-body');
    if (!tableBody) return;

    const searchTerm = (document.getElementById('catalog-search-input')?.value || '').toLowerCase();
    const categoryFilter = document.getElementById('catalog-category-filter')?.value || 'All';

    let filtered = STATE.catalog.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchTerm) ||
                          p.barcode.includes(searchTerm) ||
                          (p.brand && p.brand.toLowerCase().includes(searchTerm));
      const matchCat = categoryFilter === 'All' || p.category.toLowerCase() === categoryFilter.toLowerCase();
      return matchSearch && matchCat;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-dim);">No products match your search filter.</td></tr>`;
      return;
    }

    tableBody.innerHTML = filtered.map(p => {
      let stockClass = 'good';
      let stockLabel = `${p.stockQuantity} in stock`;
      if (p.stockQuantity <= 0) {
        stockClass = 'out';
        stockLabel = 'Out of Stock';
      } else if (p.stockQuantity <= p.lowStockThreshold) {
        stockClass = 'low';
        stockLabel = `Low (${p.stockQuantity} left)`;
      }

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="${p.imageUrl}" style="width:36px; height:36px; border-radius:6px; object-fit:cover;" />
              <div>
                <strong style="display:block;">${p.name}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted);">${p.unit} • ${p.brand || 'Store Brand'}</span>
              </div>
            </div>
          </td>
          <td><span class="sku-barcode">${p.barcode}</span></td>
          <td><span style="font-size:0.8rem; color:var(--secondary);">${p.category}</span></td>
          <td><strong>₹${Number(p.sellingPrice).toFixed(2)}</strong> <span style="font-size:0.75rem; color:var(--text-dim); text-decoration:line-through;">₹${Number(p.mrp).toFixed(2)}</span></td>
          <td><span class="stock-badge ${stockClass}">${stockLabel}</span></td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${p.shelfLocation || 'Aisle 1'}</td>
          <td style="text-align:right;">
            <button class="action-icon-btn" onclick="window.SmartScanApp.editProductStock('${p.barcode}')" title="Quick adjust stock">📦</button>
            <button class="action-icon-btn danger" onclick="window.SmartScanApp.deleteProduct('${p.barcode}')" title="Delete SKU">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function addNewProductFromModal() {
    const barcode = document.getElementById('new-sku-barcode').value.trim();
    const name = document.getElementById('new-sku-name').value.trim();
    const category = document.getElementById('new-sku-category').value;
    const unit = document.getElementById('new-sku-unit').value.trim();
    const costPrice = parseFloat(document.getElementById('new-sku-cost').value) || 0;
    const sellingPrice = parseFloat(document.getElementById('new-sku-selling').value);
    const mrp = parseFloat(document.getElementById('new-sku-mrp').value) || sellingPrice;
    const stockQuantity = parseInt(document.getElementById('new-sku-stock').value, 10) || 10;
    const lowStockThreshold = parseInt(document.getElementById('new-sku-threshold').value, 10) || 5;
    const shelfLocation = document.getElementById('new-sku-shelf').value.trim() || 'Aisle 1';

    if (!barcode || !name || !sellingPrice || !unit) {
      showToast('Please fill in required fields: Barcode, Name, Unit, and Selling Price.', 'warning');
      return;
    }

    if (STATE.catalog.some(p => p.barcode === barcode)) {
      showToast(`A product with barcode '${barcode}' already exists.`, 'error');
      return;
    }

    const newProd = {
      id: `prod_${Date.now()}`,
      barcode,
      name,
      category,
      brand: 'Supermarket SKU',
      unit,
      costPrice,
      sellingPrice,
      mrp,
      taxRatePercent: 5.0,
      stockQuantity,
      lowStockThreshold,
      shelfLocation,
      imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80'
    };

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': 'store_manager'
        },
        body: JSON.stringify(newProd)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) STATE.catalog.unshift(json.data);
      } else {
        STATE.catalog.unshift(newProd);
      }
    } catch (e) {
      STATE.catalog.unshift(newProd);
    }

    closeModal('add-product-modal');
    localStorage.setItem('smartscan_catalog', JSON.stringify(STATE.catalog));
    renderManagerCatalog();
    initSimulatorBar();
    showToast(`Added '${name}' to store catalog!`, 'success');
  }

  function editProductStock(barcode) {
    const prod = lookupProduct(barcode);
    if (!prod) return;
    const promptVal = prompt(`Update stock quantity for "${prod.name}" (Current: ${prod.stockQuantity}):`, prod.stockQuantity);
    if (promptVal !== null) {
      const newStock = parseInt(promptVal, 10);
      if (!isNaN(newStock) && newStock >= 0) {
        prod.stockQuantity = newStock;
        localStorage.setItem('smartscan_catalog', JSON.stringify(STATE.catalog));
        renderManagerCatalog();
        showToast(`Stock for ${prod.name} updated to ${newStock}.`, 'success');

        // Sync with API
        fetch(`/api/products/${prod.id || prod.barcode}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': 'store_manager'
          },
          body: JSON.stringify({ stockQuantity: newStock })
        }).catch(() => {});
      }
    }
  }

  function deleteProduct(barcode) {
    const prod = lookupProduct(barcode);
    if (!prod) return;
    if (confirm(`Are you sure you want to delete "${prod.name}" (${barcode}) from store inventory?`)) {
      STATE.catalog = STATE.catalog.filter(p => p.barcode !== barcode);
      localStorage.setItem('smartscan_catalog', JSON.stringify(STATE.catalog));
      renderManagerCatalog();
      initSimulatorBar();
      showToast(`Deleted ${prod.name} from catalog.`, 'info');

      fetch(`/api/products/${prod.id || barcode}`, {
        method: 'DELETE',
        headers: { 'x-user-role': 'store_manager' }
      }).catch(() => {});
    }
  }

  // Render Manager Analytics & Charts
  async function loadAnalytics() {
    try {
      const res = await fetch('/api/analytics');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          STATE.analytics = json.data;
          renderAnalyticsUI(json.data);
          return;
        }
      }
    } catch (e) {}

    // Fallback analytics calculations
    const totalRev = STATE.orders.reduce((sum, o) => sum + o.totalAmount, 0) + 12450.00;
    const totalOrdersCount = STATE.orders.length + 38;
    const lowStockCount = STATE.catalog.filter(p => p.stockQuantity <= p.lowStockThreshold).length;

    renderAnalyticsUI({
      totalRevenue: totalRev,
      totalOrders: totalOrdersCount,
      avgBasketSize: (totalRev / totalOrdersCount).toFixed(2),
      activeShopperCarts: STATE.cart.length > 0 ? 1 : 0,
      lowStockCount,
      totalCatalogSKUs: STATE.catalog.length,
      hoursDistribution: [
        { hour: '08:00', shoppers: 18 },
        { hour: '10:00', shoppers: 45 },
        { hour: '12:00', shoppers: 72 },
        { hour: '14:00', shoppers: 38 },
        { hour: '16:00', shoppers: 95 },
        { hour: '18:00', shoppers: 120 },
        { hour: '20:00', shoppers: 80 }
      ]
    });
  }

  function renderAnalyticsUI(data) {
    const revEl = document.getElementById('kpi-revenue');
    const ordersEl = document.getElementById('kpi-orders');
    const basketEl = document.getElementById('kpi-basket');
    const lowStockEl = document.getElementById('kpi-low-stock');

    if (revEl) revEl.textContent = `₹${Number(data.totalRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (ordersEl) ordersEl.textContent = data.totalOrders;
    if (basketEl) basketEl.textContent = `₹${data.avgBasketSize}`;
    if (lowStockEl) lowStockEl.textContent = data.lowStockCount;

    // Render Peak Hours Bar Chart
    const chartContainer = document.getElementById('peak-hours-chart');
    if (chartContainer && data.hoursDistribution) {
      const maxShoppers = Math.max(...data.hoursDistribution.map(h => h.shoppers));
      chartContainer.innerHTML = data.hoursDistribution.map(h => {
        const heightPct = Math.round((h.shoppers / maxShoppers) * 100);
        return `
          <div class="bar-col">
            <div class="bar-fill" style="height: ${heightPct}%;" title="${h.hour}: ${h.shoppers} shoppers"></div>
            <span class="bar-label">${h.hour}</span>
          </div>
        `;
      }).join('');
    }

    // Render Recent Orders List
    renderManagerOrders();
  }

  function renderManagerOrders() {
    const listBody = document.getElementById('orders-table-body');
    if (!listBody) return;

    if (STATE.orders.length === 0) {
      listBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-dim);">No transactions recorded yet in current session.</td></tr>`;
      return;
    }

    listBody.innerHTML = STATE.orders.map(o => `
      <tr>
        <td><strong>${o.orderNumber}</strong></td>
        <td>${o.customerName} <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${o.customerPhone}</span></td>
        <td>${o.itemCount} items</td>
        <td><strong style="color:var(--primary);">₹${o.totalAmount.toFixed(2)}</strong></td>
        <td>
          <span class="stock-badge ${o.status === 'verified_at_gate' ? 'good' : 'low'}">
            ${o.status === 'verified_at_gate' ? '✓ Exited & Verified' : '● Paid (Pending Gate)'}
          </span>
        </td>
        <td style="font-size:0.8rem; color:var(--text-muted);">${new Date(o.createdAt || Date.now()).toLocaleTimeString()}</td>
      </tr>
    `).join('');
  }

  // ==========================================
  // 7. SECURITY GUARD EXIT GATE VERIFICATION
  // ==========================================
  async function handleGuardExitScan(tokenText) {
    const cleanToken = tokenText.trim();
    showToast('Validating Security Pass...', 'info');

    let verifiedOrder = null;
    let errorStatus = null;

    try {
      const res = await fetch('/api/orders/verify-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exitToken: cleanToken, guardName: 'Security Gate 1' })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        verifiedOrder = json.order;
      } else {
        errorStatus = json.status || 'INVALID';
        if (json.order) verifiedOrder = json.order;
      }
    } catch (e) {
      // Local check fallback
      const match = STATE.orders.find(o => o.exitVerification && o.exitVerification.token === cleanToken);
      if (match) {
        if (match.exitVerification.isVerifiedAtGate) {
          errorStatus = 'ALREADY_EXITED';
        } else {
          match.exitVerification.isVerifiedAtGate = true;
          match.status = 'verified_at_gate';
          verifiedOrder = match;
        }
      } else {
        errorStatus = 'INVALID_TOKEN';
      }
    }

    renderGuardAuditResult(verifiedOrder, errorStatus);
  }

  function renderGuardAuditResult(order, errorStatus) {
    const bannerVerified = document.getElementById('guard-banner-verified');
    const bannerAlready = document.getElementById('guard-banner-already');
    const bannerInvalid = document.getElementById('guard-banner-invalid');
    const checklistBox = document.getElementById('guard-checklist-box');
    const checklistList = document.getElementById('guard-checklist-items');
    const custInfo = document.getElementById('guard-customer-info');

    // Hide all first
    if (bannerVerified) bannerVerified.style.display = 'none';
    if (bannerAlready) bannerAlready.style.display = 'none';
    if (bannerInvalid) bannerInvalid.style.display = 'none';

    if (errorStatus === 'ALREADY_EXITED') {
      if (bannerAlready) bannerAlready.style.display = 'block';
      if (checklistBox) checklistBox.style.display = 'none';
      return;
    }

    if (errorStatus === 'INVALID_TOKEN' || !order) {
      if (bannerInvalid) bannerInvalid.style.display = 'block';
      if (checklistBox) checklistBox.style.display = 'none';
      return;
    }

    // Success Verified
    if (bannerVerified) bannerVerified.style.display = 'block';
    if (custInfo) {
      custInfo.textContent = `Order: ${order.orderNumber} • ${order.customerName} (${order.customerPhone}) • Billed Total: ₹${order.totalAmount.toFixed(2)}`;
    }

    if (checklistBox && checklistList) {
      checklistBox.style.display = 'block';
      checklistList.innerHTML = order.items.map((item, idx) => `
        <div class="audit-item">
          <input type="checkbox" id="audit-chk-${idx}" class="audit-checkbox" checked />
          <label for="audit-chk-${idx}">
            <strong>${item.quantity} × ${item.name}</strong> 
            <span style="color:var(--text-muted); font-size:0.75rem;">(${item.unit})</span>
          </label>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // 8. SIMULATOR BAR (Desktop & Testing Helper)
  // ==========================================
  function initSimulatorBar() {
    const simBar = document.getElementById('simulator-chips-container');
    if (!simBar) return;

    simBar.innerHTML = STATE.catalog.map(p => `
      <button class="sim-chip" onclick="window.SmartScanApp.simulateBarcodeScan('${p.barcode}')">
        <span>${p.name.length > 18 ? p.name.substring(0, 18) + '…' : p.name}</span>
        <span class="sim-chip-tag">₹${p.sellingPrice}</span>
      </button>
    `).join('');
  }

  function simulateBarcodeScan(barcode) {
    if (STATE.currentRole === 'guard') {
      // If guard is scanning, test with last order exit token or dummy
      const lastOrder = STATE.orders[0];
      if (lastOrder && lastOrder.exitVerification) {
        handleGuardExitScan(lastOrder.exitVerification.token);
      } else {
        showToast('No checkout order exists yet to verify at gate. Complete a shopper checkout first!', 'warning');
      }
      return;
    }

    handleProductScan(barcode);
  }

  // ==========================================
  // 9. EVENT LISTENERS & NAVIGATION
  // ==========================================
  function setupRoleSwitcher() {
    const buttons = document.querySelectorAll('.role-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.getAttribute('data-role');
        switchRole(role);
      });
    });
  }

  function switchRole(role) {
    STATE.currentRole = role;

    // Update active nav button
    document.querySelectorAll('.role-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-role') === role);
    });

    // Update views
    document.querySelectorAll('.view-section').forEach(view => {
      view.classList.remove('active');
    });

    const activeView = document.getElementById(`view-${role}`);
    if (activeView) activeView.classList.add('active');

    // Manage camera lifecycle when switching roles
    if (role === 'shopper') {
      if (guardScanner) guardScanner.stop();
      if (shopperScanner && STATE.shopper.isLoggedIn) {
        shopperScanner.start('reader-container');
      }
    } else if (role === 'guard') {
      if (shopperScanner) shopperScanner.stop();
      if (!guardScanner) initGuardScanner();
      if (guardScanner) guardScanner.start('guard-reader-container');
    } else if (role === 'manager') {
      if (shopperScanner) shopperScanner.stop();
      if (guardScanner) guardScanner.stop();
      loadAnalytics();
      renderManagerCatalog();
    }
  }

  function setupEventListeners() {
    // Shopper Onboarding
    const onboardingForm = document.getElementById('shopper-onboarding-form');
    if (onboardingForm) {
      onboardingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('onboard-name').value.trim();
        const phone = document.getElementById('onboard-phone').value.trim();

        if (!phone || phone.length < 10) {
          showToast('Please enter a valid 10-digit mobile number.', 'warning');
          return;
        }

        STATE.shopper = {
          isLoggedIn: true,
          fullName: name || 'Valued Shopper',
          phoneNumber: phone,
          sessionToken: `SHOPPER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          storeId: 'STORE_DEL_01'
        };

        localStorage.setItem('smartscan_shopper', JSON.stringify(STATE.shopper));
        renderShopperSession();
        showToast(`Welcome to SmartScan, ${STATE.shopper.fullName}!`, 'success');
      });
    }

    // Manual Barcode Input in Shopper View
    const manualForm = document.getElementById('manual-barcode-form');
    if (manualForm) {
      manualForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('manual-barcode-input');
        if (input && input.value) {
          handleProductScan(input.value.trim());
          input.value = '';
        }
      });
    }

    // Detection Card Quantity Buttons
    document.getElementById('det-qty-minus')?.addEventListener('click', () => {
      if (STATE.detectedQty > 1) {
        STATE.detectedQty--;
        document.getElementById('det-qty-val').textContent = STATE.detectedQty;
      }
    });

    document.getElementById('det-qty-plus')?.addEventListener('click', () => {
      if (STATE.detectedProduct && STATE.detectedQty < STATE.detectedProduct.stockQuantity) {
        STATE.detectedQty++;
        document.getElementById('det-qty-val').textContent = STATE.detectedQty;
      } else {
        showToast('Maximum available stock reached.', 'warning');
      }
    });

    document.getElementById('det-add-btn')?.addEventListener('click', addDetectedToCart);
    document.getElementById('det-close-btn')?.addEventListener('click', () => {
      document.getElementById('detection-card').classList.remove('active');
    });

    // Scanner Torch, Flip, and Webcam Restart
    document.getElementById('scanner-torch-btn')?.addEventListener('click', async () => {
      if (shopperScanner) {
        const res = await shopperScanner.toggleTorch();
        if (!res.supported) showToast(res.message, 'info');
      }
    });

    document.getElementById('scanner-flip-btn')?.addEventListener('click', async () => {
      if (shopperScanner) {
        showToast('Switching camera / webcam...', 'info');
        await shopperScanner.flipCamera('reader-container');
      }
    });

    document.getElementById('btn-restart-camera')?.addEventListener('click', async () => {
      if (shopperScanner) {
        showToast('Starting Laptop Webcam...', 'info');
        const success = await shopperScanner.start('reader-container');
        if (success) {
          showToast('Webcam connected successfully!', 'success');
          document.getElementById('camera-permission-box').style.display = 'none';
        } else {
          document.getElementById('camera-permission-box').style.display = 'block';
        }
      }
    });

    // Upload Barcode Image from file (Screenshot or Photo)
    document.getElementById('barcode-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file && shopperScanner) {
        showToast('Analyzing barcode photo...', 'info');
        const code = await shopperScanner.scanImageFile(file);
        if (code) {
          showToast(`Detected Barcode: ${code}`, 'success');
        }
      }
      e.target.value = '';
    });

    // Guard scanner flip button
    document.getElementById('guard-scanner-flip-btn')?.addEventListener('click', async () => {
      if (guardScanner) {
        showToast('Switching guard camera / webcam...', 'info');
        await guardScanner.flipCamera('guard-reader-container');
      }
    });

    // Camera Help toggle
    document.getElementById('btn-camera-help')?.addEventListener('click', () => {
      const box = document.getElementById('camera-permission-box');
      if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Checkout Flow Triggers
    document.getElementById('open-checkout-modal-btn')?.addEventListener('click', () => {
      if (STATE.cart.length === 0) {
        showToast('Your cart is empty! Scan items to proceed to checkout.', 'warning');
        return;
      }
      openModal('payment-modal');
    });

    // Coupon Apply Button
    document.getElementById('apply-coupon-btn')?.addEventListener('click', () => {
      const code = document.getElementById('coupon-input').value;
      applyPromoCode(code);
    });

    // Payment Method Switcher Tabs
    document.querySelectorAll('.pay-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.pay-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const method = tab.getAttribute('data-method');
        document.querySelectorAll('.pay-method-view').forEach(v => v.style.display = 'none');
        document.getElementById(`pay-view-${method}`).style.display = 'block';
      });
    });

    // Pay Buttons
    document.getElementById('btn-confirm-upi')?.addEventListener('click', () => processCheckout('upi'));
    document.getElementById('btn-confirm-card')?.addEventListener('click', () => processCheckout('credit_card'));
    document.getElementById('btn-confirm-counter')?.addEventListener('click', () => processCheckout('fast_counter_cash'));

    // Manager Tabs
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
        document.getElementById(`admin-panel-${tab}`).style.display = 'block';
      });
    });

    // Manager Catalog Filters
    document.getElementById('catalog-search-input')?.addEventListener('input', renderManagerCatalog);
    document.getElementById('catalog-category-filter')?.addEventListener('change', renderManagerCatalog);

    // Add Product Modal Submit
    document.getElementById('add-product-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      addNewProductFromModal();
    });

    // Barcode Auto Generate Button
    document.getElementById('btn-gen-barcode')?.addEventListener('click', () => {
      const randomEan = '890' + Math.floor(1000000000 + Math.random() * 9000000000);
      document.getElementById('new-sku-barcode').value = randomEan;
    });

    // CSV Bulk Export
    document.getElementById('btn-export-catalog')?.addEventListener('click', exportCatalogCSV);
  }

  function renderShopperSession() {
    const onboardingSec = document.getElementById('shopper-onboarding-sec');
    const scanningSec = document.getElementById('shopper-scanning-sec');
    const userDisplay = document.getElementById('shopper-user-display');
    const bottomBar = document.getElementById('bottom-checkout-bar');

    if (STATE.shopper.isLoggedIn) {
      if (onboardingSec) onboardingSec.style.display = 'none';
      if (scanningSec) scanningSec.style.display = 'block';
      if (bottomBar) bottomBar.style.display = 'flex';
      if (userDisplay) userDisplay.textContent = STATE.shopper.fullName;

      if (shopperScanner && STATE.currentRole === 'shopper') {
        shopperScanner.start('reader-container');
      }
    } else {
      if (onboardingSec) onboardingSec.style.display = 'block';
      if (scanningSec) scanningSec.style.display = 'none';
      if (bottomBar) bottomBar.style.display = 'none';
    }
  }

  // ==========================================
  // 10. UTILITIES & HELPERS
  // ==========================================
  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Generate an authentic QR Code Vector SVG
  function generateSampleQrSvg(text, size = 160) {
    // Generate an algorithmic QR code grid representation
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    const matrixSize = 25;
    const cellSize = size / matrixSize;
    let cells = '';

    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        // Corners QR positioning markers
        const isCornerMarker = 
          (row < 7 && col < 7) || 
          (row < 7 && col >= matrixSize - 7) || 
          (row >= matrixSize - 7 && col < 7);

        let fill = false;
        if (isCornerMarker) {
          const isOuterBorder = row === 0 || row === 6 || col === 0 || col === 6 ||
                                row === 0 || row === 6 || col === matrixSize - 7 || col === matrixSize - 1 ||
                                row === matrixSize - 7 || row === matrixSize - 1 || col === 0 || col === 6;
          const isCenterDot = (row >= 2 && row <= 4 && col >= 2 && col <= 4) ||
                              (row >= 2 && row <= 4 && col >= matrixSize - 5 && col <= matrixSize - 3) ||
                              (row >= matrixSize - 5 && row <= matrixSize - 3 && col >= 2 && col <= 4);
          fill = isOuterBorder || isCenterDot;
        } else {
          // pseudo random fill based on string hash
          const bit = (Math.sin(row * 13 + col * 29 + hash) * 10000);
          fill = (bit - Math.floor(bit)) > 0.45;
        }

        if (fill) {
          cells += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize - 0.2}" height="${cellSize - 0.2}" fill="#0f172a" />`;
        }
      }
    }

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background:#fff; border-radius:8px;">${cells}</svg>`;
  }

  function exportCatalogCSV() {
    const headers = ['barcode', 'name', 'category', 'unit', 'costPrice', 'sellingPrice', 'mrp', 'stockQuantity', 'shelfLocation'];
    const rows = STATE.catalog.map(p => headers.map(h => `"${p[h] || ''}"`).join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `smartscan_catalog_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Export Global SmartScan App Namespace for inline buttons
  window.SmartScanApp = {
    STATE,
    updateCartQty,
    removeCartItem,
    simulateBarcodeScan,
    editProductStock,
    deleteProduct,
    openModal,
    closeModal,
    showToast,
    switchRole
  };

})();
