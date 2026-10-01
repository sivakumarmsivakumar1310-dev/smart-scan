/**
 * SmartScan Store Operations & Security Portal Client Controller
 * Connects directly to Manager Backend API
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

  // API Base URL config: supports direct port 3002, Live Server (e.g. 5500/5501), or file://
  const API_BASE = (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3002'))
    ? 'http://localhost:3002'
    : '';

  const AppState = {
    user: null,
    token: null,
    catalog: [...FALLBACK_CATALOG],
    orders: [],
    refunds: [],
    activeReturnOrder: null,
    selectedReturnItems: new Map(),
    analytics: null,
    guardScanner: null,
    currentTab: 'inventory',
    config: null
  };

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Initial Data & Session Check
  async function init() {
    bindEvents();
    await loadConfig();
    restoreSession();
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          AppState.config = json.data;
          const uInput = document.getElementById('mgr-username');
          const pInput = document.getElementById('mgr-password');
          const pinInput = document.getElementById('mgr-pin');
          if (uInput && json.data.defaultManagerUsername) uInput.value = json.data.defaultManagerUsername;
          if (pInput) pInput.value = 'SmartStore@2026';
          if (pinInput && json.data.defaultManagerPin) pinInput.value = json.data.defaultManagerPin;
          const gPinInput = document.getElementById('guard-pin-input');
          if (gPinInput && json.data.defaultGuardPin) gPinInput.value = json.data.defaultGuardPin;
        }
      }
    } catch (e) {}
  }

  function restoreSession() {
    const saved = localStorage.getItem('smartscan_manager_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        AppState.user = parsed.user;
        AppState.token = parsed.token;
        showDashboardView();
        return;
      } catch (e) {}
    }
    showLoginView();
  }

  function showLoginView() {
    const loginSec = document.getElementById('portal-login-sec');
    const dashSec = document.getElementById('portal-dashboard-sec');
    const userBadge = document.getElementById('header-user-badge');

    if (loginSec) loginSec.style.display = 'block';
    if (dashSec) dashSec.style.display = 'none';
    if (userBadge) userBadge.style.display = 'none';
  }

  function showDashboardView() {
    const loginSec = document.getElementById('portal-login-sec');
    const dashSec = document.getElementById('portal-dashboard-sec');
    const userBadge = document.getElementById('header-user-badge');
    const userRoleEl = document.getElementById('user-role-label');

    if (loginSec) loginSec.style.display = 'none';
    if (dashSec) dashSec.style.display = 'block';
    if (userBadge) userBadge.style.display = 'flex';
    if (userRoleEl && AppState.user) {
      userRoleEl.textContent = AppState.user.role === 'security_guard' ? '🛡️ Gate Security' : '👔 Store Manager';
    }

    // Default tab depending on role
    if (AppState.user && AppState.user.role === 'security_guard') {
      switchTab('guard');
    } else {
      switchTab('inventory');
      loadCatalog();
      loadAnalytics();
      loadOrders();
    }
  }

  // Tab Switcher
  function switchTab(tabName) {
    AppState.currentTab = tabName;
    const tabBtns = document.querySelectorAll('.nav-tab-btn');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    const panels = {
      inventory: document.getElementById('panel-inventory'),
      orders: document.getElementById('panel-orders'),
      returns: document.getElementById('panel-returns'),
      analytics: document.getElementById('panel-analytics'),
      guard: document.getElementById('panel-guard')
    };

    Object.keys(panels).forEach(key => {
      if (panels[key]) {
        panels[key].style.display = (key === tabName) ? 'block' : 'none';
      }
    });

    if (tabName === 'guard') {
      initGuardScanner();
    } else {
      if (AppState.guardScanner) {
        AppState.guardScanner.stop();
      }
    }

    if (tabName === 'inventory') loadCatalog();
    if (tabName === 'orders') loadOrders();
    if (tabName === 'returns') {
      loadOrders();
      loadReturnsList();
      populateReturnSampleChips();
    }
    if (tabName === 'analytics') loadAnalytics();
  }

  // Load Inventory Catalog
  async function loadCatalog() {
    const search = (document.getElementById('catalog-search-input')?.value || '').trim().toLowerCase();
    const category = document.getElementById('catalog-category-filter')?.value || 'All';
    const lowStockOnly = document.getElementById('catalog-low-stock-check')?.checked || false;

    // 1. Check localStorage first
    const saved = localStorage.getItem('smartscan_catalog');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          AppState.catalog = parsed;
        }
      } catch (e) {}
    }

    // 2. Try fetching from Backend API if configured and available
    if (API_BASE) {
      try {
        let url = `${API_BASE}/api/products?category=${encodeURIComponent(category)}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (lowStockOnly) url += `&lowStockOnly=true`;

        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            AppState.catalog = json.data;
            localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
          }
        }
      } catch (e) {}
    }

    // 3. Fallback load from sample_products.json if catalog is minimal
    if (!AppState.catalog || AppState.catalog.length <= 5) {
      try {
        const sampleRes = await fetch('./data/sample_products.json').catch(() => fetch('../data/sample_products.json'));
        if (sampleRes && sampleRes.ok) {
          const sampleData = await sampleRes.json();
          if (Array.isArray(sampleData) && sampleData.length > 0) {
            AppState.catalog = sampleData;
            localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
          }
        }
      } catch (e) {}
    }

    // Filter displayed catalog
    let filtered = AppState.catalog || [];
    if (category !== 'All') {
      filtered = filtered.filter(p => p.category === category);
    }
    if (search) {
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(search)) ||
        (p.barcode && p.barcode.includes(search)) ||
        (p.brand && p.brand.toLowerCase().includes(search)) ||
        (p.shelfLocation && p.shelfLocation.toLowerCase().includes(search))
      );
    }
    if (lowStockOnly) {
      filtered = filtered.filter(p => Number(p.stockQuantity) <= (Number(p.lowStockThreshold) || 10));
    }

    renderCatalogTable(filtered);
    updateKPIsFromCatalog();
  }

  function updateKPIsFromCatalog() {
    const lowStockCount = (AppState.catalog || []).filter(p => Number(p.stockQuantity) <= (Number(p.lowStockThreshold) || 10)).length;
    const lowStockEl = document.getElementById('kpi-low-stock');
    if (lowStockEl) lowStockEl.textContent = lowStockCount;
  }

  function renderCatalogTable(products) {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;

    if (!products || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">No products found matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const isLow = Number(p.stockQuantity) <= (Number(p.lowStockThreshold) || 10);
      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="${p.imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80'}" style="width:40px; height:40px; border-radius:6px; object-fit:cover;" />
              <div>
                <strong>${p.name}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${p.unit || '1 unit'} • ${p.brand || 'Store'}</span>
              </div>
            </div>
          </td>
          <td><code>${p.barcode}</code></td>
          <td><span style="font-size:0.8rem; background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:4px;">${p.category}</span></td>
          <td><strong>₹${Number(p.sellingPrice).toFixed(2)}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(MRP: ₹${Number(p.mrp || p.sellingPrice).toFixed(2)})</span></td>
          <td>
            <span class="stock-badge ${isLow ? 'low' : 'good'}">${p.stockQuantity} in stock</span>
          </td>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${p.shelfLocation || 'General'}</span></td>
          <td style="text-align:right;">
            <button class="btn-secondary" style="padding:4px 8px; font-size:0.75rem;" onclick="window.SmartManager.adjustStock('${p.id}', 10)">+10</button>
            <button class="btn-secondary" style="padding:4px 8px; font-size:0.75rem;" onclick="window.SmartManager.adjustStock('${p.id}', -5)">-5</button>
            <button class="btn-danger" style="padding:4px 8px; font-size:0.75rem; margin-left:4px;" onclick="window.SmartManager.deleteSKU('${p.id}')">✕</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Stock Adjustment
  async function adjustStock(id, delta) {
    const item = AppState.catalog.find(p => p.id === id || p.barcode === id);
    if (item) {
      item.stockQuantity = Math.max(0, (Number(item.stockQuantity) || 0) + delta);
      localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
      showToast(`Stock updated for ${item.name} (${item.stockQuantity})`, 'success');
      loadCatalog();
      loadAnalytics();
    }

    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/api/products/${id}/stock`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjustment: delta })
        });
      }
    } catch (e) {}
  }

  // Delete SKU
  async function deleteSKU(id) {
    if (!confirm('Are you sure you want to remove this SKU from catalog?')) return;

    AppState.catalog = AppState.catalog.filter(p => p.id !== id && p.barcode !== id);
    localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
    showToast('SKU deleted from inventory.', 'info');
    loadCatalog();
    loadAnalytics();

    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/api/products/${id}`, { method: 'DELETE' });
      }
    } catch (e) {}
  }

  // Add SKU Modal Form
  async function handleAddProduct(e) {
    e.preventDefault();
    const barcode = document.getElementById('new-sku-barcode').value.trim();
    const name = document.getElementById('new-sku-name').value.trim();
    const category = document.getElementById('new-sku-category').value;
    const unit = document.getElementById('new-sku-unit').value.trim() || '1 unit';
    const costPrice = Number(document.getElementById('new-sku-cost').value) || 0;
    const sellingPrice = Number(document.getElementById('new-sku-selling').value) || 0;
    const mrp = Number(document.getElementById('new-sku-mrp').value) || sellingPrice;
    const stockQuantity = Number(document.getElementById('new-sku-stock').value) || 0;
    const lowStockThreshold = Number(document.getElementById('new-sku-threshold').value) || 10;
    const shelfLocation = document.getElementById('new-sku-shelf').value.trim() || 'General Shelf';

    const newProd = {
      id: `prod_${Date.now()}`,
      barcode,
      name,
      category,
      unit,
      costPrice,
      sellingPrice,
      mrp,
      stockQuantity,
      lowStockThreshold,
      shelfLocation,
      brand: 'Store Brand',
      imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80'
    };

    AppState.catalog.unshift(newProd);
    localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
    showToast(`Added '${name}' to catalog!`, 'success');
    closeModal('add-product-modal');
    document.getElementById('add-product-form').reset();
    loadCatalog();
    loadAnalytics();

    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newProd)
        });
      }
    } catch (err) {}
  }

  // Export CSV
  function exportCatalogCSV() {
    if (!AppState.catalog || AppState.catalog.length === 0) {
      showToast('Catalog is empty.', 'error');
      return;
    }

    const headers = ['id', 'barcode', 'name', 'category', 'unit', 'costPrice', 'sellingPrice', 'mrp', 'stockQuantity', 'lowStockThreshold', 'shelfLocation', 'brand'];
    const rows = AppState.catalog.map(p => headers.map(h => {
      const val = p[h] !== undefined && p[h] !== null ? String(p[h]) : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `SmartScan_Catalog_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Catalog exported to CSV.', 'success');
  }

  // Import CSV
  function importCatalogCSV(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 1) {
          showToast('CSV file is empty or has only headers.', 'error');
          return;
        }

        const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
        const imported = [];

        for (let i = 1; i < lines.length; i++) {
          const rowText = lines[i];
          const cols = rowText.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || rowText.split(',');
          const cleanCols = cols.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

          const getVal = (colNames) => {
            for (const name of colNames) {
              const idx = rawHeaders.indexOf(name.toLowerCase());
              if (idx !== -1 && cleanCols[idx] !== undefined) return cleanCols[idx];
            }
            return '';
          };

          const barcode = getVal(['barcode', 'code', 'ean']) || ('890' + Math.floor(1000000000 + Math.random() * 9000000000));
          const name = getVal(['name', 'product', 'title', 'item']) || `Product ${i}`;
          const category = getVal(['category', 'cat', 'department']) || 'Gourmet & Cooking';
          const sellingPrice = parseFloat(getVal(['sellingprice', 'price', 'rate', 'sp'])) || 100;
          const mrp = parseFloat(getVal(['mrp', 'maxprice'])) || sellingPrice;
          const costPrice = parseFloat(getVal(['costprice', 'cost', 'cp'])) || (sellingPrice * 0.8);
          const stockQuantity = parseInt(getVal(['stockquantity', 'stock', 'qty', 'quantity'])) || 50;
          const lowStockThreshold = parseInt(getVal(['lowstockthreshold', 'threshold', 'minstock'])) || 10;
          const unit = getVal(['unit', 'size', 'weight']) || '1 unit';
          const shelfLocation = getVal(['shelflocation', 'shelf', 'location', 'aisle']) || 'Aisle 1';

          imported.push({
            id: getVal(['id']) || `prod_${Date.now()}_${i}`,
            barcode,
            name,
            category,
            unit,
            costPrice,
            sellingPrice,
            mrp,
            stockQuantity,
            lowStockThreshold,
            shelfLocation,
            brand: getVal(['brand']) || 'Store',
            imageUrl: getVal(['imageurl', 'image']) || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80'
          });
        }

        if (imported.length > 0) {
          const existingMap = new Map((AppState.catalog || []).map(p => [p.barcode, p]));
          imported.forEach(p => existingMap.set(p.barcode, p));
          AppState.catalog = Array.from(existingMap.values());
          localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));
          showToast(`Successfully imported ${imported.length} products!`, 'success');
          loadCatalog();
          loadAnalytics();
        }
      } catch (err) {
        showToast('Error parsing CSV file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // Load Orders
  async function loadOrders() {
    try {
      const res = await fetch(`${API_BASE}/api/orders`);
      const json = await res.json();
      if (json.success) {
        AppState.orders = json.data;
        renderOrdersTable(AppState.orders);
      }
    } catch (e) {}
  }

  function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">No self-checkout orders recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const isVerified = o.exitVerification && o.exitVerification.isVerifiedAtGate;
      return `
        <tr>
          <td><strong>${o.orderNumber}</strong></td>
          <td>${o.customerName || 'Shopper'} <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${o.customerPhone || ''}</span></td>
          <td>${o.itemCount || 0} items</td>
          <td><strong style="color:var(--primary);">₹${Number(o.totalAmount).toFixed(2)}</strong></td>
          <td>
            <span class="stock-badge ${isVerified ? 'good' : 'low'}">
              ${isVerified ? '✓ Cleared Gate' : '⏳ Pending Gate Scan'}
            </span>
          </td>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${new Date(o.createdAt).toLocaleTimeString()}</span></td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RETURN & REFUND MANAGEMENT ENGINE
  // ==========================================
  function populateReturnSampleChips() {
    const container = document.getElementById('return-sample-chips');
    if (!container) return;

    const sampleOrders = [
      'ORD-20260918-1021',
      'ORD-20260918-2453',
      'ORD-20260918-7890'
    ];

    if (AppState.orders && AppState.orders.length > 0) {
      AppState.orders.slice(0, 3).forEach(o => {
        if (!sampleOrders.includes(o.orderNumber)) {
          sampleOrders.unshift(o.orderNumber);
        }
      });
    }

    container.innerHTML = sampleOrders.slice(0, 4).map(num => `
      <button type="button" class="quick-order-chip" onclick="window.SmartManager.lookupOrderForReturn('${num}')">
        ${num}
      </button>
    `).join('');
  }

  async function lookupOrderForReturn(orderNumber) {
    if (!orderNumber || !orderNumber.trim()) {
      showToast('Please enter a valid order number.', 'error');
      return;
    }

    const cleanNum = orderNumber.trim();
    const input = document.getElementById('return-order-input');
    if (input) input.value = cleanNum;

    // Search local orders first
    let order = (AppState.orders || []).find(o => o.orderNumber === cleanNum || o.orderId === cleanNum);

    // Fallback: Fetch from API
    if (!order && API_BASE) {
      try {
        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(cleanNum)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            order = json.data;
          }
        }
      } catch (e) {}
    }

    // Fallback Seed Order if not found in database (to ensure instant frictionless demo)
    if (!order) {
      order = {
        orderId: `ord_seed_${cleanNum}`,
        orderNumber: cleanNum,
        customerName: 'Alex Sharma',
        customerPhone: '9876543210',
        storeName: 'Smart Supermarket',
        items: [
          {
            barcode: '8901030383794',
            name: 'FarmFresh Organic Whole Milk',
            unit: '1 Litre',
            quantity: 2,
            sellingPrice: 64.00,
            mrp: 70.00,
            taxRatePercent: 5.0,
            lineTotal: 128.00
          },
          {
            barcode: '8901063012722',
            name: 'NuttyDelight Roasted California Almonds',
            unit: '200g Pack',
            quantity: 1,
            sellingPrice: 220.00,
            mrp: 250.00,
            taxRatePercent: 12.0,
            lineTotal: 220.00
          },
          {
            barcode: '8901491101838',
            name: 'Artisan Sourdough Loaf',
            unit: '450g',
            quantity: 1,
            sellingPrice: 89.00,
            mrp: 99.00,
            taxRatePercent: 5.0,
            lineTotal: 89.00
          }
        ],
        itemCount: 4,
        subtotal: 437.00,
        taxTotal: 21.85,
        totalAmount: 458.85,
        totalSavings: 48.00,
        status: 'paid',
        payment: { method: 'upi', methodLabel: 'UPI Instant Pay' },
        createdAt: new Date().toISOString()
      };
    }

    AppState.activeReturnOrder = order;
    AppState.selectedReturnItems.clear();
    renderActiveReturnOrder(order);
    showToast(`Loaded Order #${cleanNum}`, 'success');
  }

  function renderActiveReturnOrder(order) {
    const box = document.getElementById('return-active-order-box');
    const numLabel = document.getElementById('return-order-num-label');
    const statusBadge = document.getElementById('return-order-status-badge');
    const customerMeta = document.getElementById('return-order-customer-meta');
    const origTotal = document.getElementById('return-order-orig-total');
    const tbody = document.getElementById('return-items-tbody');

    if (!box || !tbody) return;

    box.style.display = 'block';
    if (numLabel) numLabel.textContent = order.orderNumber;
    if (statusBadge) statusBadge.textContent = `● ${(order.status || 'PAID').toUpperCase()}`;
    if (customerMeta) {
      const pMethod = order.payment?.methodLabel || order.payment?.method?.toUpperCase() || 'UPI';
      customerMeta.textContent = `Customer: ${order.customerName || 'Valued Shopper'} (${order.customerPhone || '9876543210'}) • Paid via ${pMethod} on ${new Date(order.createdAt).toLocaleDateString()}`;
    }
    if (origTotal) origTotal.textContent = `₹${Number(order.totalAmount || 0).toFixed(2)}`;

    const items = Array.isArray(order.items) ? order.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:18px; color:var(--text-muted);">No items recorded on this invoice.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(item => {
      const barcode = item.barcode || item.name;
      const unitPrice = Number(item.sellingPrice || item.price || 50);
      const taxRate = Number(item.taxRatePercent || 5);
      const maxQty = parseInt(item.quantity, 10) || 1;

      // Quantity options
      let qtyOptions = '';
      for (let q = 1; q <= maxQty; q++) {
        qtyOptions += `<option value="${q}" ${q === 1 ? 'selected' : ''}>${q} of ${maxQty}</option>`;
      }

      return `
        <tr id="return-row-${barcode}">
          <td style="text-align:center;">
            <input type="checkbox" class="return-item-check" id="check-${barcode}" onchange="window.SmartManager.toggleReturnItem('${barcode}')" />
          </td>
          <td>
            <strong>${item.name}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted); display:block;"><code>${item.barcode || 'N/A'}</code> • ${item.unit || '1 unit'}</span>
          </td>
          <td>₹${unitPrice.toFixed(2)}</td>
          <td><strong>× ${maxQty}</strong></td>
          <td>
            <select class="return-qty-select" id="qty-select-${barcode}" onchange="window.SmartManager.changeReturnQty('${barcode}', this.value)">
              ${qtyOptions}
            </select>
          </td>
          <td>
            <select class="return-reason-select" id="reason-select-${barcode}" onchange="window.SmartManager.changeReturnReason('${barcode}', this.value)">
              <option value="Defective / Quality Issue">Defective / Quality Issue</option>
              <option value="Customer Changed Mind">Customer Changed Mind</option>
              <option value="Wrong Item Purchased">Wrong Item Purchased</option>
              <option value="Expired Product">Expired / Near Expiry</option>
              <option value="Damaged Packaging">Damaged Packaging</option>
            </select>
          </td>
          <td style="text-align:right;">
            <strong style="color:#ef4444;" id="refund-line-${barcode}">₹${(unitPrice * (1 + taxRate/100)).toFixed(2)}</strong>
          </td>
        </tr>
      `;
    }).join('');

    calculateRefundTotals();
  }

  function toggleReturnItem(barcode) {
    const order = AppState.activeReturnOrder;
    if (!order) return;

    const item = (order.items || []).find(i => (i.barcode || i.name) === barcode);
    if (!item) return;

    const checkEl = document.getElementById(`check-${barcode}`);
    const rowEl = document.getElementById(`return-row-${barcode}`);
    const qtySelect = document.getElementById(`qty-select-${barcode}`);
    const reasonSelect = document.getElementById(`reason-select-${barcode}`);

    const isChecked = checkEl ? checkEl.checked : false;

    if (isChecked) {
      const qty = parseInt(qtySelect ? qtySelect.value : 1, 10) || 1;
      const reason = reasonSelect ? reasonSelect.value : 'Customer Return';
      const unitPrice = Number(item.sellingPrice || 50);
      const taxRate = Number(item.taxRatePercent || 5);
      const lineRefund = unitPrice * qty * (1 + taxRate / 100);

      AppState.selectedReturnItems.set(barcode, {
        barcode: item.barcode,
        name: item.name,
        unitPrice,
        taxRatePercent: taxRate,
        quantity: qty,
        reason,
        refundAmount: lineRefund
      });

      if (rowEl) rowEl.classList.add('selected-row');
    } else {
      AppState.selectedReturnItems.delete(barcode);
      if (rowEl) rowEl.classList.remove('selected-row');
    }

    calculateRefundTotals();
  }

  function changeReturnQty(barcode, qtyStr) {
    const qty = parseInt(qtyStr, 10) || 1;
    if (AppState.selectedReturnItems.has(barcode)) {
      const entry = AppState.selectedReturnItems.get(barcode);
      entry.quantity = qty;
      entry.refundAmount = entry.unitPrice * qty * (1 + entry.taxRatePercent / 100);
      AppState.selectedReturnItems.set(barcode, entry);

      const lineEl = document.getElementById(`refund-line-${barcode}`);
      if (lineEl) lineEl.textContent = `₹${entry.refundAmount.toFixed(2)}`;
    }
    calculateRefundTotals();
  }

  function changeReturnReason(barcode, reason) {
    if (AppState.selectedReturnItems.has(barcode)) {
      const entry = AppState.selectedReturnItems.get(barcode);
      entry.reason = reason;
      AppState.selectedReturnItems.set(barcode, entry);
    }
  }

  function calculateRefundTotals() {
    let totalRefund = 0;
    let totalItems = 0;

    AppState.selectedReturnItems.forEach(item => {
      totalRefund += item.refundAmount;
      totalItems += item.quantity;
    });

    const countEl = document.getElementById('return-selected-count');
    const totalEl = document.getElementById('return-total-refund-val');
    const btnProcess = document.getElementById('btn-process-refund');

    if (countEl) countEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;
    if (totalEl) totalEl.textContent = `₹${totalRefund.toFixed(2)}`;

    if (btnProcess) {
      btnProcess.disabled = totalItems === 0;
      btnProcess.style.opacity = totalItems === 0 ? '0.5' : '1';
      btnProcess.style.cursor = totalItems === 0 ? 'not-allowed' : 'pointer';
    }
  }

  async function processSelectedRefund() {
    const order = AppState.activeReturnOrder;
    if (!order) {
      showToast('No active order selected for refund.', 'error');
      return;
    }

    if (AppState.selectedReturnItems.size === 0) {
      showToast('Please select at least one item to return.', 'error');
      return;
    }

    const returnedItems = Array.from(AppState.selectedReturnItems.values());
    const methodSelect = document.getElementById('return-refund-method');
    const refundMethod = methodSelect ? methodSelect.value : 'Original UPI/Card';
    const managerName = AppState.user ? AppState.user.username : 'Store Manager';

    let totalRefund = 0;
    returnedItems.forEach(i => totalRefund += i.refundAmount);

    const payload = {
      orderNumber: order.orderNumber,
      returnedItems,
      refundMethod,
      managerName
    };

    try {
      // 1. Send to Backend API if server available
      let responseData = null;
      if (API_BASE) {
        try {
          const res = await fetch(`${API_BASE}/api/returns/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success) responseData = json.data;
          }
        } catch (err) {}
      }

      // 2. Offline / Local fallback: Update stock & save refund
      if (!responseData) {
        const refundId = `REF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
        responseData = {
          refundId,
          orderNumber: order.orderNumber,
          customerName: order.customerName || 'Valued Shopper',
          customerPhone: order.customerPhone || '9876543210',
          totalRefundAmount: Number(totalRefund.toFixed(2)),
          itemsReturned: returnedItems,
          itemsCount: returnedItems.reduce((sum, i) => sum + i.quantity, 0),
          refundMethod,
          processedBy: managerName,
          status: 'COMPLETED',
          processedAt: new Date().toISOString()
        };
      }

      // 3. Automatically Restock Catalog Inventory locally
      returnedItems.forEach(ret => {
        const catProduct = AppState.catalog.find(p => p.barcode === ret.barcode || p.name === ret.name);
        if (catProduct) {
          catProduct.stockQuantity = (Number(catProduct.stockQuantity) || 0) + ret.quantity;
        }
      });
      localStorage.setItem('smartscan_catalog', JSON.stringify(AppState.catalog));

      // 4. Save to Refunds DB
      if (!AppState.refunds) AppState.refunds = [];
      AppState.refunds.unshift(responseData);
      localStorage.setItem('smartscan_refunds', JSON.stringify(AppState.refunds));

      // 5. Success Feedback
      showToast(`🎉 Refund #${responseData.refundId} of ₹${Number(responseData.totalRefundAmount).toFixed(2)} approved! Inventory replenished.`, 'success');

      // 6. Reset UI
      AppState.selectedReturnItems.clear();
      const activeBox = document.getElementById('return-active-order-box');
      if (activeBox) activeBox.style.display = 'none';
      const orderInput = document.getElementById('return-order-input');
      if (orderInput) orderInput.value = '';

      loadReturnsList();
      loadCatalog();
      loadAnalytics();
    } catch (error) {
      showToast(`Refund processing error: ${error.message}`, 'error');
    }
  }

  async function loadReturnsList() {
    // 1. Try local storage
    const saved = localStorage.getItem('smartscan_refunds');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) AppState.refunds = parsed;
      } catch (e) {}
    }

    // 2. Fetch from API
    if (API_BASE) {
      try {
        const res = await fetch(`${API_BASE}/api/returns`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            AppState.refunds = json.data;
            localStorage.setItem('smartscan_refunds', JSON.stringify(AppState.refunds));
          }
        }
      } catch (e) {}
    }

    renderRefundsHistoryTable(AppState.refunds || []);
  }

  function renderRefundsHistoryTable(refunds) {
    const tbody = document.getElementById('refunds-history-tbody');
    if (!tbody) return;

    if (!refunds || refunds.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">No returns processed yet. All customer sales are intact.</td></tr>`;
      return;
    }

    tbody.innerHTML = refunds.map(r => {
      const itemsList = (r.itemsReturned || []).map(i => `<span style="display:block; font-size:0.75rem;">• ${i.name} (×${i.quantity})</span>`).join('');
      return `
        <tr>
          <td><strong style="color:#f87171; font-family:monospace;">${r.refundId}</strong></td>
          <td><strong>${r.orderNumber}</strong></td>
          <td>${r.customerName || 'Shopper'} <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${r.customerPhone || ''}</span></td>
          <td>${itemsList || `${r.itemsCount || 1} items`}</td>
          <td><strong style="color:#ef4444; font-size:0.95rem;">₹${Number(r.totalRefundAmount || 0).toFixed(2)}</strong></td>
          <td><span class="restocked-badge">✓ Restocked +${r.itemsCount || 1}</span></td>
          <td><span style="font-size:0.78rem;">${r.processedBy || 'Manager'} (${r.refundMethod || 'UPI'})</span></td>
          <td><span style="font-size:0.75rem; color:var(--text-muted);">${new Date(r.processedAt || Date.now()).toLocaleTimeString()}</span></td>
        </tr>
      `;
    }).join('');
  }

  // Load Analytics & Peak Hours
  async function loadAnalytics() {
    try {
      const res = await fetch(`${API_BASE}/api/analytics`);
      const json = await res.json();
      if (json.success && json.data) {
        AppState.analytics = json.data;
        const d = json.data;

        const revEl = document.getElementById('kpi-revenue');
        const ordersEl = document.getElementById('kpi-orders');
        const basketEl = document.getElementById('kpi-basket');
        const lowStockEl = document.getElementById('kpi-low-stock');

        if (revEl) revEl.textContent = `₹${d.totalRevenue.toFixed(2)}`;
        if (ordersEl) ordersEl.textContent = d.totalOrders;
        if (basketEl) basketEl.textContent = `₹${d.avgBasketSize.toFixed(2)}`;
        if (lowStockEl) lowStockEl.textContent = d.lowStockCount;

        // Render Peak Hours Chart
        const chartEl = document.getElementById('peak-hours-chart');
        if (chartEl && d.hoursDistribution) {
          const maxShoppers = Math.max(...d.hoursDistribution.map(h => h.shoppers), 1);
          chartEl.innerHTML = d.hoursDistribution.map(h => {
            const pct = Math.round((h.shoppers / maxShoppers) * 100);
            return `
              <div class="bar-row">
                <span class="bar-label">${h.hour}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${pct}%;"></div>
                </div>
                <span style="font-size:0.75rem; font-weight:700; width:40px; text-align:right;">${h.shoppers}</span>
              </div>
            `;
          }).join('');
        }

        // Render Top Products
        const topListEl = document.getElementById('top-products-list');
        if (topListEl && d.bestSellers) {
          topListEl.innerHTML = d.bestSellers.map(p => `
            <div class="top-prod-item">
              <div>
                <strong>${p.name}</strong>
              </div>
              <span class="stock-badge good">${p.unitsSold} units</span>
            </div>
          `).join('');
        }
      }
    } catch (e) {}
  }

  // Exit Gate Security QR Scanner
  function initGuardScanner() {
    if (AppState.guardScanner) return;

    AppState.guardScanner = new SmartGuardScanner({
      videoElementId: 'guard-reader-container',
      onDetected: (token) => verifyExitPass(token),
      onStatusChange: ({ status, message }) => {
        const text = document.getElementById('guard-status-text');
        if (text) text.textContent = message;
      }
    });

    AppState.guardScanner.start().catch(() => {});
  }

  async function verifyExitPass(token) {
    if (!token) return;

    // Reset banners
    const bVerified = document.getElementById('guard-banner-verified');
    const bAlready = document.getElementById('guard-banner-already');
    const bInvalid = document.getElementById('guard-banner-invalid');
    const checklistBox = document.getElementById('guard-checklist-box');
    const checklistItems = document.getElementById('guard-checklist-items');

    [bVerified, bAlready, bInvalid].forEach(b => b && (b.style.display = 'none'));
    if (checklistBox) checklistBox.style.display = 'none';

    try {
      const res = await fetch(`${API_BASE}/api/orders/verify-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exitToken: token })
      });

      const data = await res.json();

      if (data.success && data.status === 'VERIFIED_SUCCESS') {
        if (AppState.guardScanner) AppState.guardScanner.playBeep('success');
        if (bVerified) {
          bVerified.style.display = 'block';
          const infoEl = document.getElementById('guard-customer-info');
          if (infoEl && data.order) {
            infoEl.textContent = `Order #${data.order.orderNumber} • ₹${data.order.totalAmount} • ${data.order.customerName || 'Shopper'}`;
          }
        }

        // Render Bag Checklist
        if (checklistBox && checklistItems && data.order && data.order.items) {
          checklistItems.innerHTML = data.order.items.map(item => `
            <div class="checklist-item">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" checked />
                <span>${item.name}</span>
              </label>
              <strong style="color:var(--primary);">× ${item.quantity}</strong>
            </div>
          `).join('');
          checklistBox.style.display = 'block';
        }

        showToast('Exit Pass VERIFIED! Customer cleared to exit.', 'success');
      } else if (data.status === 'ALREADY_EXITED') {
        if (AppState.guardScanner) AppState.guardScanner.playBeep('error');
        if (bAlready) bAlready.style.display = 'block';
        showToast('Security Alert: This pass has ALREADY been used!', 'error');
      } else {
        if (AppState.guardScanner) AppState.guardScanner.playBeep('error');
        if (bInvalid) bInvalid.style.display = 'block';
        showToast('Invalid / Counterfeit QR pass', 'error');
      }
    } catch (err) {
      if (bInvalid) bInvalid.style.display = 'block';
      showToast('Security verification request failed', 'error');
    }
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

  // Event Listeners
  function bindEvents() {
    // Manager Login Tab Switches
    const tabMgrCreds = document.getElementById('login-tab-creds');
    const tabMgrPin = document.getElementById('login-tab-pin');
    const tabGuard = document.getElementById('login-tab-guard');

    const formCreds = document.getElementById('form-mgr-creds');
    const formPin = document.getElementById('form-mgr-pin');
    const formGuard = document.getElementById('form-guard-pin');

    function switchLoginTab(t) {
      [tabMgrCreds, tabMgrPin, tabGuard].forEach(b => b && b.classList.remove('active'));
      [formCreds, formPin, formGuard].forEach(f => f && (f.style.display = 'none'));

      if (t === 'creds') {
        tabMgrCreds?.classList.add('active');
        if (formCreds) formCreds.style.display = 'block';
      } else if (t === 'pin') {
        tabMgrPin?.classList.add('active');
        if (formPin) formPin.style.display = 'block';
      } else if (t === 'guard') {
        tabGuard?.classList.add('active');
        if (formGuard) formGuard.style.display = 'block';
      }
    }

    tabMgrCreds?.addEventListener('click', () => switchLoginTab('creds'));
    tabMgrPin?.addEventListener('click', () => switchLoginTab('pin'));
    tabGuard?.addEventListener('click', () => switchLoginTab('guard'));

    // Form: Manager Creds
    formCreds?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = (document.getElementById('mgr-username')?.value || '').trim();
      const password = (document.getElementById('mgr-password')?.value || '').trim();

      const isValid = (username.toLowerCase() === 'admin' || username.toLowerCase() === 'manager' || username.length >= 3) &&
                      (password === 'SmartStore@2026' || password === 'admin' || password === '1234' || password === 'password' || password.length >= 4);

      // Attempt backend verification if not running as a local file
      if (!window.location.protocol.startsWith('file')) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/manager-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) {
              AppState.user = data.data.user;
              AppState.token = data.data.token;
              localStorage.setItem('smartscan_manager_session', JSON.stringify(data.data));
              showDashboardView();
              showToast('Manager logged in successfully.', 'success');
              return;
            }
          }
        } catch (err) {
          console.warn('Backend server note:', err.message);
        }
      }

      // Standalone & offline resilient login
      if (isValid) {
        const mgrData = {
          token: `AUTH-ADMIN-${Date.now()}`,
          user: {
            username: username || 'admin',
            role: 'store_manager',
            storeId: 'STORE_104',
            storeName: 'Smart Supermarket Operations',
            permissions: ['catalog_crud', 'stock_adjust', 'analytics_view', 'audit_logs']
          }
        };
        AppState.user = mgrData.user;
        AppState.token = mgrData.token;
        localStorage.setItem('smartscan_manager_session', JSON.stringify(mgrData));
        showDashboardView();
        showToast(`Welcome, ${mgrData.user.username}!`, 'success');
      } else {
        showToast('Invalid credentials! Demo: admin / SmartStore@2026', 'error');
      }
    });

    // Form: Manager PIN
    formPin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pinCode = (document.getElementById('mgr-pin')?.value || '').trim();
      const isValidPin = (pinCode === '1234' || pinCode === '9999' || pinCode === '0000' || pinCode === 'admin' || pinCode.length >= 4);

      if (!window.location.protocol.startsWith('file')) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/manager-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinCode })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) {
              AppState.user = data.data.user;
              AppState.token = data.data.token;
              localStorage.setItem('smartscan_manager_session', JSON.stringify(data.data));
              showDashboardView();
              showToast('Authenticated via PIN.', 'success');
              return;
            }
          }
        } catch (err) {
          console.warn('Backend server note:', err.message);
        }
      }

      if (isValidPin) {
        const mgrData = {
          token: `AUTH-MANAGER-${Date.now()}`,
          user: {
            username: 'Store Manager',
            role: 'store_manager',
            storeId: 'STORE_104',
            permissions: ['catalog_crud', 'stock_adjust', 'analytics_view', 'audit_logs']
          }
        };
        AppState.user = mgrData.user;
        AppState.token = mgrData.token;
        localStorage.setItem('smartscan_manager_session', JSON.stringify(mgrData));
        showDashboardView();
        showToast('Authenticated via PIN.', 'success');
      } else {
        showToast('Invalid PIN! Configured demo PIN: 1234', 'error');
      }
    });

    // Form: Guard Login
    formGuard?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const guardPin = (document.getElementById('guard-pin-input')?.value || '').trim();
      const isValidGuard = (guardPin === '5678' || guardPin === '1234' || guardPin === '0000' || guardPin.length >= 4);

      if (!window.location.protocol.startsWith('file')) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/guard-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guardPin })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) {
              AppState.user = data.data.user;
              AppState.token = data.data.token;
              localStorage.setItem('smartscan_manager_session', JSON.stringify(data.data));
              showDashboardView();
              showToast('Security Guard Gate Active.', 'success');
              return;
            }
          }
        } catch (err) {
          console.warn('Backend server note:', err.message);
        }
      }

      if (isValidGuard) {
        const guardData = {
          token: `AUTH-GUARD-${Date.now()}`,
          user: {
            username: 'Officer Singh',
            role: 'security_guard',
            gateId: 'GATE_01',
            storeId: 'STORE_104'
          }
        };
        AppState.user = guardData.user;
        AppState.token = guardData.token;
        localStorage.setItem('smartscan_manager_session', JSON.stringify(guardData));
        showDashboardView();
        showToast('Security Guard Gate Active.', 'success');
      } else {
        showToast('Invalid Guard PIN! Configured PIN: 5678', 'error');
      }
    });

    // Logout
    document.getElementById('btn-mgr-logout')?.addEventListener('click', () => {
      localStorage.removeItem('smartscan_manager_session');
      AppState.user = null;
      AppState.token = null;
      showLoginView();
      showToast('Logged out of operations portal.', 'info');
    });

    // Dashboard Tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Catalog Search & Filters
    document.getElementById('catalog-search-input')?.addEventListener('input', () => loadCatalog());
    document.getElementById('catalog-category-filter')?.addEventListener('change', () => loadCatalog());
    document.getElementById('catalog-low-stock-check')?.addEventListener('change', () => loadCatalog());

    // Export CSV
    document.getElementById('btn-export-catalog')?.addEventListener('click', exportCatalogCSV);

    // Import CSV file input
    document.getElementById('catalog-csv-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        importCatalogCSV(file);
      }
      e.target.value = '';
    });

    // Auto-generate barcode button
    document.getElementById('btn-gen-barcode')?.addEventListener('click', () => {
      const bInput = document.getElementById('new-sku-barcode');
      if (bInput) {
        bInput.value = '890' + Math.floor(1000000000 + Math.random() * 9000000000);
      }
    });

    // Add Product Form Submit
    document.getElementById('add-product-form')?.addEventListener('submit', handleAddProduct);

    // Manual Guard Token Input
    document.getElementById('guard-token-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('guard-manual-token-input');
      if (input && input.value.trim()) {
        verifyExitPass(input.value.trim());
        input.value = '';
      }
    });
    // Form: Return & Refund Lookup Submit
    document.getElementById('form-return-lookup')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('return-order-input');
      if (input && input.value.trim()) {
        lookupOrderForReturn(input.value.trim());
      }
    });
  }

  // Public Interface
  window.SmartManager = {
    adjustStock,
    deleteSKU,
    openModal,
    closeModal,
    showToast,
    exportCatalogCSV,
    importCatalogCSV,
    lookupOrderForReturn,
    toggleReturnItem,
    changeReturnQty,
    changeReturnReason,
    processSelectedRefund,
    loadReturnsList
  };

  document.addEventListener('DOMContentLoaded', init);
})();
