const GAS_URL = 'https://script.google.com/macros/s/AKfycbz4Er2HkHWYOycE4pS8pGDWbpxz-QgRXXzmj8_RzBWBoosMcEcCIDs5ONyme6NC96gGyg/exec';

function gasGet_(action, params) {
  var url = GAS_URL + '?action=' + action;
  if (params) {
    Object.keys(params).forEach(function(k) {
      url += '&' + k + '=' + encodeURIComponent(params[k]);
    });
  }
  // Cache-busting: paksa GAS kirim response fresh setiap request
  url += '&_t=' + Date.now();
  return fetch(url).then(function(r) { return r.json(); });
}

function gasPost_(action, body) {
  body.action = action;
  return fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); });
}


    // ===== GLOBAL STATE (WAJIB) =====
    let uploadedFile = null;
    let selectedYear = null;     // tahun yang dipilih (string)
    let selectedRate = 0;        // tarif hunian (number)
    let previewObjectUrl = null;   // 🔥 untuk revoke object URL preview
    let activeTabType = 'pending';
    let activePolling = null;
    let uidLoadedRows = new Set();
    let activeTimeFilter = 'all';
    let activeRateFilter = null;
    let currentUser = null;   // { email, role, blocks }
    let wargaPaidMonths = null;
    let wargaPendingMonths = null; // { '2026': [4, 5], '2025': [11] } — bulan yg masih Pending
    let wargaRateByMonth = null; // { '2025': { '2025_0': 200000, '2025_7': 175000 }, ... }
    let userOverrideRateByYear = {}; // { '2025': 175000, '2026': 200000 }
    let selectedMonthsByYear = {}; // { '2025': [6], '2026': [1] }
    let blokToastTimeout = null;
    let activeToastTimer = null;
    let blokSuggestionIndex = -1;
    let currentSuggestions = [];

    // ===== GREETING SVG ICONS =====
    var _GREET_SVG_ = {
      pagi  : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#F59E0B" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
      siang : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
      sore  : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#FB923C" stroke-width="2" viewBox="0 0 24 24"><path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 9v3M12 2v1M4.22 4.22l.7.7M2 12h1M22 12h-1M18.36 5.64l-.7.7"/><path d="M3 18h18" stroke-linecap="round"/></svg>',
      malam : '<svg style="display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:middle;flex-shrink:0;" fill="none" stroke="#818CF8" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    };
    function _getGreetingHTML_(hour) {
      if (hour < 11) return { text: 'Selamat pagi',  svg: _GREET_SVG_.pagi  };
      if (hour < 15) return { text: 'Selamat siang', svg: _GREET_SVG_.siang };
      if (hour < 18) return { text: 'Selamat sore',  svg: _GREET_SVG_.sore  };
      return           { text: 'Selamat malam',       svg: _GREET_SVG_.malam };
    }

    // ===== SESSION PERSIST (7 DAYS) =====
    var SESSION_KEY = 'jps2_session';
    var SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 hari dalam milliseconds

    function saveSession(user) {
      if (!user) return;
      var sessionData = {
        user: user,
        timestamp: Date.now()
      };
      try {
        var raw = JSON.stringify(sessionData);
        localStorage.setItem(SESSION_KEY, raw);
        sessionStorage.setItem(SESSION_KEY, raw);
      } catch(e) {
        console.warn('Gagal menyimpan session:', e);
      }
    }

    function loadSession() {
      try {
        var stored = localStorage.getItem(SESSION_KEY);
        if (!stored) {
          stored = sessionStorage.getItem(SESSION_KEY);
        }
        if (!stored) return null;
        var sessionData = JSON.parse(stored);
        var now = Date.now();
        if (now - sessionData.timestamp > SESSION_TTL) {
          clearSession();
          return null;
        }
        // Refresh timestamp agar tidak expire
        sessionData.timestamp = now;
        var raw = JSON.stringify(sessionData);
        localStorage.setItem(SESSION_KEY, raw);
        sessionStorage.setItem(SESSION_KEY, raw);
        return sessionData.user;
      } catch(e) {
        console.warn('Gagal memuat session:', e);
        return null;
      }
    }

    function clearSession() {
      try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      } catch(e) {
        console.warn('Gagal menghapus session:', e);
      }
    }

    // ===== RESTORE SESSION ON PAGE LOAD =====
    // Banner selalu load tanpa syarat login
    setTimeout(function() { if (typeof loadHeaderGreeting === 'function') loadHeaderGreeting(); }, 300);

    (function() {
      var restoredUser = loadSession();
      if (restoredUser) {
        currentUser = restoredUser;
        setTimeout(function() {
          updateHeaderAuthUI();
          initNotifications();
          loadHomeData();
          // Fetch ulang wargaData jika belum ada
          if (!currentUser.wargaData || !currentUser.wargaData.length) {
            gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
              .then(function(dataRes) {
                if (dataRes && dataRes.success) {
                  currentUser.wargaData = dataRes.data || [];
                  saveSession(currentUser);
                }
              });
          }
        }, 100);
      }
    })();

    // ===== iOS PWA: re-check session saat app kembali visible =====
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && !currentUser) {
        var restoredUser = loadSession();
        if (restoredUser) {
          currentUser = restoredUser;
          updateHeaderAuthUI();
          loadHomeData();
          if (!currentUser.wargaData || !currentUser.wargaData.length) {
            gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
              .then(function(dataRes) {
                if (dataRes && dataRes.success) {
                  currentUser.wargaData = dataRes.data || [];
                  saveSession(currentUser);
                }
              });
          }
        }
      }
    });

    // ===== SPLASH SCREEN =====
    (function() {
      var splash = document.getElementById('splashScreen');
      if (!splash) return;
      setTimeout(function() {
        splash.style.opacity = '0';
        setTimeout(function() {
          splash.style.display = 'none';
        }, 500);
      }, 2000);
    })();

    const VALID_BLOK_LIST = [
    "A1","A2","A3","A5",
    "B1","B2","B3","B5","B6","B7","B8","B9","B10","B11","B12","B12A",
    "C1","C2","C3","C5","C6","C7","C8","C9","C10","C11","C12","C12A","C15","C16","C17","C18","C19",
    "D1","D2","D3","D5","D6","D7","D8","D9","D10","D11","D12","D12A","D15","D16","D17","D18","D19",
    "D20","D21","D22","D23","D23A","D25","D26","D27","D28","D29","D30","D31","D32","D33","D34","D35","D36","D37",
    "E1","E2","E3","E5","E6","E7","E8","E9","E10","E11","E12","E12A","E15","E16","E17","E18","E19",
    "E20","E21","E22","E23","E23A","E25","E26","E27","E28","E29","E30","E31","E32",
    "F1","F2","F3","F5","F6","F7","F8","F9","F10","F11","F12","F12A",
    "F20","F21","F22","F23","F23A","F25","F26","F27","F28",
    "G1","G2","G3","G5","G6","G7","G8","G9","G10","G11","G12",
    "G14","G15","G16","G17","G18","G19","G20","G21","G22","G23","G24","G25","G26","G27","G28",
    "H1","H2","H3","H5","H6","H7","H8","H9","H10","H11","H12",
    "H14","H15","H16","H17","H18","H19","H20","H21","H22","H23","H24","H25","H26",
    "I1","I2","I3","I5","I6","I7","I8","I9","I10","I11","I12",
    "I14","I15","I16","I17","I18"
    ];

    function getBlokSuggestions(input) {

      const val = input.toUpperCase().trim();

      if (!val) return [];

      const results = VALID_BLOK_LIST
        .filter(b => b.startsWith(val))
        .sort((a,b)=>a.localeCompare(b,'en',{numeric:true}))
        .slice(0,6);

      currentSuggestions = results;
      blokSuggestionIndex = -1;

      return results;
    }

    function updateHeaderAuthUI() {
      const infoEl   = document.getElementById('headerUserInfo');
      const greetEl  = document.getElementById('headerGreeting');
      const greetTxt = document.getElementById('headerGreetingText');
      if (!infoEl) return;

      if (!currentUser) {
        infoEl.classList.add('hidden');
        infoEl.innerText = '';
        if (greetEl) greetEl.classList.add('hidden');
        updateTarifDisplay_(false);
        updateNavAdminVisibility();
        _updateDesktopSidebarProfile_();
        return;
      }

      infoEl.classList.add('hidden');

      // Tampilkan nama + icon waktu di header
      if (greetEl && greetTxt) {
        var _h = new Date().getHours();
        var _icons = {
          pagi  : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F59E0B" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
          siang : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
          sore  : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#F97316" stroke-width="2" viewBox="0 0 24 24"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>',
          malam : '<svg style="width:13px;height:13px;display:inline;vertical-align:-1px;margin-right:3px" fill="none" stroke="#818CF8" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        };
        var _label = _h < 11 ? 'pagi' : _h < 15 ? 'siang' : _h < 18 ? 'sore' : 'malam';
        var _fullName = (currentUser.fullName || currentUser.email || '');
        greetTxt.innerHTML = _icons[_label]
          + (_label.charAt(0).toUpperCase() + _label.slice(1))
          + ', ' + _fullName;
        greetEl.classList.remove('hidden');
        greetEl.classList.add('flex');
      }

      updateTarifDisplay_(true);
      updateNavAdminVisibility();
      _updateDesktopSidebarProfile_();
      if (typeof _showDarkModeBtn_ === 'function') _showDarkModeBtn_();
    }

    function updateTarifDisplay_(isLoggedIn) {
      var el200 = document.getElementById('tarifNominal200');
      var el175 = document.getElementById('tarifNominal175');
      if (el200) el200.innerHTML = isLoggedIn ? 'Rp200.000' : 'Rp&nbsp;<span style="letter-spacing:2px">••••••</span>';
      if (el175) el175.innerHTML = isLoggedIn ? 'Rp175.000' : 'Rp&nbsp;<span style="letter-spacing:2px">••••••</span>';
    }

    function handleHeaderAuthClick() {
      openPageSaya();
    }

    function shakeField(el){
      if(!el) return;
      el.classList.add('shake');
      setTimeout(()=>{
        el.classList.remove('shake');
      },400);
    }

    function triggerInputError(el){
      if(!el) return;
      // focus field
      el.focus();
      // shake animation
      shakeField(el);
      el.classList.add('error-pulse');
      setTimeout(()=>{
        el.classList.remove('error-pulse');
      },250);
      // haptic feedback (mobile)
      if(navigator.vibrate){
        navigator.vibrate(40);
      }
      // highlight error border
      el.classList.add('border-red-500');
    }

    function setBlokError(msg) {
      const err = document.getElementById('blokError');
      if (!err) return;
      err.innerText = msg;
      err.classList.remove('hidden');
      blokInput.classList.add('border-red-500');
      shakeField(blokInput);
    }

    function clearBlokError(){
      const err = document.getElementById('blokError');
      if (!err) return;
      err.classList.add('hidden');
      err.innerText = '';
      blokInput.classList.remove('border-red-500');
    }

    function highlightBlokSuggestion(index){
      const chips = document.querySelectorAll('.blok-chip');
      chips.forEach(c => c.classList.remove('active'));
      if(chips[index]){
        chips[index].classList.add('active');
      }
    }

    /* ======================================
      PAGE SAYA (LOGIN PAGE REPLACEMENT)
    ====================================== */

  // Avatar color palette — pick by first char code
  var _avatarColors_ = [
    '#4CAF50','#2196F3','#9C27B0','#FF5722','#009688',
    '#3F51B5','#E91E63','#FF9800','#607D8B','#795548'
  ];
  function _renderProfileAvatar_(name) {
    var el = document.getElementById('sayaProfileAvatar');
    if (!el) return;
    var initial = (name || '?').trim().charAt(0).toUpperCase();
    var colorIdx = ((name || '').charCodeAt(0) || 0) % _avatarColors_.length;
    el.style.background = _avatarColors_[colorIdx];
    el.textContent = initial;
  }

    function openPageSaya() {
      var page = document.getElementById('pageSaya');
      if (!page) return;

      document.body.classList.add('saya-open');
      setActiveNavById('navMe');
      if (!history.state || !history.state.saya) {
        history.pushState({ saya: true }, '');
      }
      switchPage('pageSaya');

      // ===== BELUM LOGIN =====
      if (!currentUser) {
        document.getElementById('sayaStepEmail')?.classList.remove('hidden');
        document.getElementById('sayaStepOTP')?.classList.add('hidden');
        document.getElementById('sayaLoggedInView')?.classList.add('hidden');
        return;
      }
      // ===== SUDAH LOGIN =====
      document.body.classList.remove('saya-open');
      var _se = document.getElementById('sayaStepEmail');
      if (_se) { _se.classList.add('hidden'); _se.style.display = ''; }
      var _sm = document.getElementById('sayaStepMethod');
      if (_sm) { _sm.classList.add('hidden'); _sm.style.display = ''; }
      var _so = document.getElementById('sayaStepOTP');
      if (_so) { _so.classList.add('hidden'); _so.style.display = ''; }
      var loggedInView = document.getElementById('sayaLoggedInView');
      if (loggedInView) {
        loggedInView.classList.remove('hidden');
        loggedInView.style.display = 'flex';
        loggedInView.style.flexDirection = 'column';
        loggedInView.style.flex = '1';
        loggedInView.style.minHeight = '0';
      }

      // ===== RE-RENDER NAMA & EMAIL =====
      var nameEl  = document.getElementById('sayaProfileName');
      var profEmail = document.getElementById('sayaProfileEmail');
      if (nameEl)    nameEl.innerText  = currentUser.fullName || '';
      if (profEmail) profEmail.innerText = currentUser.email || '';
      _renderProfileAvatar_(currentUser.fullName || '');
      _updateDesktopSidebarProfile_();

      // ===== RE-RENDER BLOK LIST =====
      function renderSayaWargaData_(data) {
        var listEl = document.getElementById('sayaBlokList');
        if (listEl) {
          listEl.innerHTML = '';
          var blokLabels = data
            .map(function(item) { return item.blok || ''; })
            .filter(Boolean)
            .join(', ');
          var div = document.createElement('div');
          div.className = 'text-sm font-medium text-gray-900 mt-0.5';
          div.innerText = blokLabels || '—';
          listEl.appendChild(div);
        }
        var namaEl  = document.getElementById('sayaNamaInput');
        var hpEl    = document.getElementById('sayaHpInput');
        var emailEl = document.getElementById('sayaEmailEditInput');
        var badgeEl = document.getElementById('sayaProfileBlokBadge');
        if (namaEl)    namaEl.value  = data[0].nama  || '';
        if (hpEl)      hpEl.value    = data[0].noHp  || '';
        if (emailEl)   emailEl.value = data[0].email || currentUser.email || '';
        if (badgeEl && data.length) {
          badgeEl.innerText = 'Blok ' + data.map(function(d){ return d.blok; }).join(', ');
        }
      }

      if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
        renderSayaWargaData_(currentUser.wargaData);
      } else if (currentUser && currentUser.email) {
        // Belum ada wargaData di session → fetch
        gasGet_('getCurrentUserDataWarga', { email: currentUser.email }).then(function(wRes) {
          if (!currentUser) return;
          if (!wRes || !wRes.success || !wRes.data || !wRes.data.length) return;
          currentUser.wargaData = wRes.data;
          saveSession(currentUser);
          renderSayaWargaData_(wRes.data);
        });
      }

      // ===== FORCE RESET EDIT MODE (ANTI NYANGKUT) =====
      const namaInput = document.getElementById('sayaNamaInput');
      const hpInput = document.getElementById('sayaHpInput');
      const emailInput = document.getElementById('sayaEmailEditInput');
      const editBtn = document.getElementById('sayaEditBtn');
      const saveBtn = document.getElementById('sayaSaveBtn');
      [namaInput, hpInput].forEach(function(el) {
        if (!el) return;
        el.readOnly = true;
        el.style.borderBottom = '';
        el.style.paddingBottom = '';
      });
      editBtn?.classList.remove('hidden');
      saveBtn?.classList.add('hidden');

      // Jika sudah di page Saya → scroll to top
      var sayaScroll = document.querySelector('#pageSaya .flex-1.overflow-y-auto');
      if (sayaScroll) sayaScroll.scrollTop = 0;
    }

    function openEmailLogin() {
      const area = document.getElementById('emailLoginArea');
      if (!area) return;

      area.classList.remove('hidden');

      const input = document.getElementById('sayaEmailInput');
      if (input) {
        input.focus();
      }
    }

    // ===== DASHBOARD CACHE STATE =====
    let dashboardCache = null;
    let dashboardPendingCache = [];
    let dashboardConfirmedCache = [];
    let dashboardRejectedCache = [];
    let wargaScoreFilter = 'all'; // 'all' | 'pending' | 'confirmed'

    let customDateRange = null;

    const customBtn   = document.getElementById('customFilterBtn');
    const customPanel = document.getElementById('customRangePanel');
    const startInput = document.getElementById('startDateInput');
    const endInput   = document.getElementById('endDateInput');
    const applyBtn   = document.getElementById('applyCustomRangeBtn');
    const clearBtn   = document.getElementById('clearCustomRangeBtn');

    const chips = document.querySelectorAll('.chip');

    // ===== BLOK AUTO LOOKUP STATE =====
    let residentSuggestion = null;
    let multiDecisionMode = null; 
    // 'all' | 'single' | 'update'

    // ===== BLOK LOOKUP CONTROL =====
    let isLookupLocked = false;  // ⛔ stop auto lookup setelah decision

    // ===== AUTOFILL HELPERS =====
    function markAutofilled(el) {
      if (!el) return;
      el.dataset.autofilled = 'true';
      el.classList.add('autofilled');
    }

    function clearAutofilled(el) {
      if (!el) return;
      delete el.dataset.autofilled;
      el.classList.remove('autofilled');
    }

    // ===== UI CLEANUP HELPERS =====
    function removeUpdateSuggestionBtn() {
      const btn = document.getElementById('updateSuggestion');
      if (btn) btn.remove();
    }

    function buildUidHTML(item) {

    const bulanArray = (item.bulan || '')
      .toString()
      .split(',')
      .map(b => b.trim());

    let html = '';

    bulanArray.forEach((bulan, index) => {

      const uid = item.uidList[index] || '-';

      html += `
        <div class="flex justify-between items-center
              text-sm py-2 px-3 rounded-lg
              border-b border-gray-100 last:border-none">

          <span class="text-gray-500">
            ${bulan} ${item.tahun}
          </span>

          <span class="font-mono text-gray-900">
            ${uid}
          </span>

        </div>
      `;
    });

    return html;
  }

    // ===== IDENTITY RESET (WAJIB) =====
    function resetIdentityFields() {
      ['blok', 'nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.value = '';
        clearAutofilled(el);
      });

      // reset lookup state
      residentSuggestion = null;
      isLookupLocked = false;
      multiDecisionMode = null;

      // hide suggestion UI
      if (suggestionBox) suggestionBox.classList.add('hidden');
      removeUpdateSuggestionBtn();
      unlockIdentityFields();   // pastikan selalu editable saat reset
    }

    // ===== SEARCH ICON STATE =====
    function setBlokSearchLoading(isLoading) {
      const btn = document.getElementById('blokSearchBtn');
      const icon = document.getElementById('blokSearchIcon');
      if (!btn || !icon) return;

      btn.disabled = isLoading;

      if (isLoading) {
        icon.classList.add('searching', 'searching-pulse');
        btn.classList.add('text-green-600');
      } else {
        icon.classList.remove('searching', 'searching-pulse');
        btn.classList.remove('text-green-600');
      }
    }
    
    const nominalInput = document.getElementById('nominal');
    const manualCheckbox = document.getElementById('manualNominal');
    
    const noHpInput = document.getElementById('noHp');

    // ===== CLEAR AUTOFILL FLAG ON MANUAL INPUT =====
    ['nama', 'email', 'noHp'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      el.addEventListener('input', () => {
        updateSubmitButtonState();
      });
    });
    
    // ===== BLOK LOOKUP ELEMENT =====
    const blokInput = document.getElementById('blok');
    const suggestionBox = document.getElementById('blokSuggestion');

    if (suggestionBox) {
      suggestionBox.addEventListener('mousedown', function(e) {
        const chip = e.target.closest('.blok-chip');
        if (!chip) return;

        const val = blokInput.value;
        const parts = val.split(',');

        parts[parts.length - 1] = chip.innerText;

        blokInput.value = parts.join(', ').trim();

        suggestionBox.classList.add('hidden');

        triggerBlokLookup();
      });
    }
    const suggestionText = document.getElementById('blokSuggestionText');
    const blokLoading = document.getElementById('blokLookupLoading');

    // ===== BLOK LOOKUP – ICON SEARCH TRIGGER =====
    var blokBtn = document.getElementById('blokSearchBtn');
    if (blokBtn) {
      blokBtn.addEventListener('click', triggerBlokLookup);
    }

    function isValidBlokFormat(value) {
      if (!value) return false;

      const parts = value
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(Boolean);

      // Format: 1 huruf + 1-3 angka
      const regex = /^[A-Z][0-9]{1,3}[A-Z]?$/;

      return parts.every(part => regex.test(part));
    }

    // ===== BLOK LOOKUP TRIGGER (CENTRAL FUNCTION) =====
    function triggerBlokLookup() {

      if (isLookupLocked) return;

      const val = blokInput.value.trim();

      // ===== EMPTY =====
      if (!val) {
        setBlokError('Nomor blok rumah wajib diisi');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      // ===== INVALID FORMAT =====
      if (!isValidBlokFormat(val)) {

        setBlokError('Format blok tidak valid (contoh: B10)');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      const inputBloks = val
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(Boolean);

      const allValid = inputBloks.every(b =>
        VALID_BLOK_LIST.includes(b)
      );

      // ===== BLOK TIDAK ADA =====
      if (!allValid) {

        setBlokError('Nomor blok tidak ditemukan');

        resetIdentityFields();
        lockIdentityFields();

        return;
      }

      // ===== VALID =====
      clearBlokError();

      if (blokLoading) blokLoading.classList.remove('hidden');
      setBlokSearchLoading(true);

      residentSuggestion = null;
      if (suggestionBox) suggestionBox.classList.add('hidden');

      blokInput.classList.remove('border-red-500');

      var _snapshotBloks_ = val
        .split(',')
        .map(function(b){ return b.trim().toUpperCase(); })
        .filter(Boolean);

      var _lookupToken_ = val;

      gasGet_('getResidentByBlock', { blok: val })
        .then(function(res) {
          setBlokSearchLoading(false);
          if (blokLoading) blokLoading.classList.add('hidden');

          // Abaikan response jika input sudah berubah atau dikosongkan
          if (blokInput.value.trim() === '' || blokInput.value.trim().toUpperCase() !== _lookupToken_.toUpperCase()) {
            if (suggestionBox) suggestionBox.classList.add('hidden');
            return;
          }

          if (!res || !res.found) {
            residentSuggestion = null;
            if (suggestionBox) suggestionBox.classList.add('hidden');
            return;
          }
          handleResidentResult(res, _snapshotBloks_);
        })
        .catch(function() {
          setBlokSearchLoading(false);
          if (blokLoading) blokLoading.classList.add('hidden');
          showToast('Gagal mengambil data warga','error');
        });
    }

    function fillResidentData(res) {
      const nama = document.getElementById('nama');
      const email = document.getElementById('email');
      const noHp = document.getElementById('noHp');

      if (nama) {
        nama.value = res.nama || '';
        markAutofilled(nama);
      }

      if (email) {
        email.value = res.email || '';
        markAutofilled(email);
      }

      if (noHp) {
        noHp.value = res.noHp || '';
        markAutofilled(noHp);
      }
    }

    function lockIdentityFields() {
      ['nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly = true;
        el.classList.add('bg-gray-100', 'cursor-not-allowed');
      });
    }

    function unlockIdentityFields() {
      ['nama', 'email', 'noHp'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly = false;
        el.classList.remove('bg-gray-100', 'cursor-not-allowed');
      });
    }

    /* ================= MASKING HELPERS ================= */
    function maskName(name = '') {
      if (!name) return '-';

      return name
        .split(' ')
        .map(part => {
          if (part.length <= 2) return part[0] + '*';
          if (part.length <= 6) {
            // Tampilkan huruf pertama, mask tengah, tampilkan 1 terakhir
            return part[0] + '*'.repeat(part.length - 2) + part.slice(-1);
          }
          // Panjang > 6: tampilkan huruf pertama + 5 huruf terakhir
          return part[0] + '*'.repeat(part.length - 6) + part.slice(-5);
        })
        .join(' ');
    }

    function maskEmail(email = '') {
      if (!email || !email.includes('@')) return '-';

      const [local, domainFull] = email.split('@');
      const domainParts = domainFull.split('.');
      const mainDomain = domainParts[0];
      const ext = domainParts.slice(1).join('.');

      // ===== MASK LOCAL (USERNAME) =====
      let maskedLocal = '';

      const parts = local.split('.');

      maskedLocal = parts.map(part => {
        if (part.length <= 2) {
          return part[0] + '*';
        }
        if (part.length <= 4) {
          return part[0] + '*'.repeat(part.length - 2) + part.slice(-1);
        }
        // Tampilkan 1 pertama + 3 terakhir sebelum @
        return (
          part[0] +
          '*'.repeat(part.length - 4) +
          part.slice(-3)
        );
      }).join('.');

      // ===== MASK DOMAIN =====
      const commonProviders = [
        'gmail',
        'yahoo',
        'outlook',
        'icloud',
        'hotmail'
      ];

      let maskedDomain = mainDomain;

      if (!commonProviders.includes(mainDomain.toLowerCase())) {
        maskedDomain =
          mainDomain[0] +
          '*'.repeat(mainDomain.length - 2) +
          mainDomain.slice(-1);
      }

      return `${maskedLocal}@${maskedDomain}${ext ? '.' + ext : ''}`;
    }

    function maskPhone(phone = '') {
      if (!phone) return '-';

      const clean = String(phone).replace(/\s/g, '');
      if (clean.length <= 6) return clean;

      // Tampilkan 4 depan + 3 belakang, tengah di-mask
      return (
        clean.slice(0, 4) +
        '*'.repeat(Math.max(2, clean.length - 7)) +
        clean.slice(-3)
      );
    }

    function handleResidentResult(res, snapshotBloks) {

      residentSuggestion = res;

      const card = suggestionBox;
      const text = suggestionText;

      const inputBloks = snapshotBloks || blokInput.value
        .split(',')
        .map(b => b.trim().toUpperCase())
        .filter(Boolean);

      const related = res.relatedBlocks || [];

      const hasValidEmail =
        res.email && res.email.trim().length > 0;

      const isMultiDetected =
        hasValidEmail &&
        related.length > 1 &&
        inputBloks.length === 1;

      // =========================
      // MULTI BLOK DETECTED
      // =========================
      if (isMultiDetected) {

        text.innerHTML = `
          💡 Kami mendeteksi Anda memiliki beberapa rumah.<br><br>

          <b>Daftar blok:</b><br>
          ${related.map(b => `• ${b}`).join('<br>')}
          <br><br>

          Nama: <b>${maskName(res.nama)}</b><br>
          Email: <b>${maskEmail(res.email)}</b><br>
          No HP: <b>${maskPhone(res.noHp)}</b>

          <div class="mt-3">
            <button id="useResidentData"
              class="w-full bg-primary text-white text-sm py-2 rounded-lg font-medium">
              Ya gunakan untuk semua
            </button>
          </div>
        `;

        const current = inputBloks[0];
        const others = related.filter(b => b !== current);

        blokInput.value = [current, ...others].join(', ');

      } else {

        const blokList = related.length
          ? related.join(', ')
          : res.blok;

        text.innerHTML = `
          💡 Data warga ditemukan.<br><br>

          Blok: <b>${blokList}</b><br>
          Nama: <b>${maskName(res.nama)}</b><br>
          Email: <b>${maskEmail(res.email)}</b><br>
          No HP: <b>${maskPhone(res.noHp)}</b>

          <div class="mt-3">
            <button id="useResidentData"
              class="w-full bg-primary text-white text-sm py-2 rounded-lg font-medium">
              Ya gunakan data ini
            </button>
          </div>
        `;
      }

      // =========================
      // UI
      // =========================

      card.classList.remove('hidden');
      card.classList.remove('animate-fadeIn');
      void card.offsetWidth;
      card.classList.add('animate-fadeIn');

      setTimeout(() => {

        const useBtn = document.getElementById('useResidentData');

        if (useBtn) {
          useBtn.onclick = () => {

            useBtn.disabled = true;

            const namaEl = document.getElementById('nama');
            const emailEl = document.getElementById('email');
            const hpEl = document.getElementById('noHp');

            if (namaEl) {
              namaEl.dataset.fullValue = res.nama || '';
              namaEl.value = maskName(res.nama);
              markAutofilled(namaEl);
            }

            if (emailEl) {
              emailEl.dataset.fullValue = res.email || '';
              emailEl.value = maskEmail(res.email);
              markAutofilled(emailEl);
            }

            if (hpEl) {
              hpEl.dataset.fullValue = res.noHp || '';
              hpEl.value = maskPhone(res.noHp);
              markAutofilled(hpEl);
            }

            lockIdentityFields();

            isLookupLocked = true;

            suggestionBox.classList.add('hidden');

            showToast('Data warga digunakan','success');

            // Auto-load paid months berdasarkan email dari lookup result
            // (cover: admin bantu warga, dan warga tidak login)
            // SELALU fetch fresh per blok — jangan pakai cache dari blok sebelumnya
            var lookupEmail = res.email || '';
            if (lookupEmail) {
              // Reset cache dulu agar data blok lama tidak carry-over
              wargaPaidMonths    = null;
              wargaPendingMonths = null;
              wargaRateByMonth   = null;
              userOverrideRateByYear = {};
              selectedMonthsByYear = {};

              showDetailPaymentSkeleton_(true);
              gasGet_('getWargaPaidMonths', { email: lookupEmail })
                .then(function(pmRes) {
                  showDetailPaymentSkeleton_(false);
                  if (!pmRes || !pmRes.ok) return;
                  wargaPaidMonths  = pmRes.paid;
                  wargaRateByMonth = pmRes.rateByMonth || null;
                  applyPaidMonthsData_(pmRes);
                })
                .catch(function() {
                  showDetailPaymentSkeleton_(false);
                });
            } else {
              updateNominalAuto();
            }
          };
        }

      },0);
    }

    if (noHpInput) {
      noHpInput.addEventListener('input', () => {
        let val = noHpInput.value;

        // 1️⃣ Hapus semua selain angka dan +
        val = val.replace(/[^\d+]/g, '');

        // 2️⃣ Jika mulai dengan 0 → ganti jadi +62
        if (val.startsWith('0')) {
          val = '+62' + val.slice(1);
        }

        // 3️⃣ Jika mulai dengan 62 tanpa + → tambahkan +
        if (val.startsWith('62')) {
          val = '+' + val;
        }

        // 4️⃣ Cegah + lebih dari satu
        if ((val.match(/\+/g) || []).length > 1) {
          val = '+' + val.replace(/\+/g, '');
        }

        noHpInput.value = val;
      });
    }

    // ===== BLOK AUTO LOOKUP (TRIGGER CENTRAL) =====
    if (blokInput) {

      blokInput.addEventListener('input', () => {
        clearBlokError();
        blokInput.value = blokInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9,]/g, '');

        isLookupLocked = false;
        multiDecisionMode = null;

        const val = blokInput.value.trim();

        if (!val) {
          blokInput.classList.remove('border-red-500');
          suggestionBox.classList.add('hidden');
          residentSuggestion = null;
          isLookupLocked = false;
          suggestionText.innerHTML = '';
          return;
        }

        // 🔥 ambil blok terakhir untuk suggestion
        const parts = val.split(',');
        const lastPart = parts[parts.length - 1].trim();

        const suggestions = getBlokSuggestions(lastPart);

        if(suggestions.length === 1){

          // Jika lastPart sudah exact match → jangan replace seluruh value
          if(lastPart.toUpperCase() === suggestions[0].toUpperCase()){
            suggestionBox.classList.add('hidden');
            triggerBlokLookup();
            return;
          }

          // Belum exact → replace lastPart saja, bukan seluruh value
          parts[parts.length - 1] = suggestions[0];
          blokInput.value = parts.join(', ').trim();

          suggestionBox.classList.add('hidden');

          triggerBlokLookup();

          return;

        }
        
        if (suggestions.length) {

          blokInput.classList.remove('border-red-500');

          suggestionText.innerHTML =
            suggestions.map((b,i) =>
              `<span class="blok-chip" data-index="${i}">${b}</span>`
            ).join(' ');

          suggestionBox.classList.remove('hidden');

          // animasi muncul
          suggestionBox.classList.remove('animate-suggest');
          void suggestionBox.offsetWidth;
          suggestionBox.classList.add('animate-suggest');

        } else {

          blokInput.classList.add('border-red-500');
          suggestionBox.classList.add('hidden');

          clearTimeout(blokToastTimeout);
          blokToastTimeout = setTimeout(() => {
            showToast('Nomor blok tidak ditemukan','error');
          }, 500);
        }

      });

      // 🔹 trigger saat pindah field
      // blokInput.addEventListener('blur', triggerBlokLookup);

      // 🔹 trigger saat tekan ENTER
      blokInput.addEventListener('keydown', e => {
        const chips = document.querySelectorAll('.blok-chip');
        if(e.key === 'ArrowDown'){
          e.preventDefault();
          blokSuggestionIndex++;
          if(blokSuggestionIndex >= chips.length){
            blokSuggestionIndex = 0;
          }
          highlightBlokSuggestion(blokSuggestionIndex);
        }

        if(e.key === 'ArrowUp'){
          e.preventDefault();
          blokSuggestionIndex--;
          if(blokSuggestionIndex < 0){
            blokSuggestionIndex = chips.length-1;
          }
          highlightBlokSuggestion(blokSuggestionIndex);
        }

        if(e.key === 'Enter'){
          if(blokSuggestionIndex >=0){
            e.preventDefault();
            const val = currentSuggestions[blokSuggestionIndex];
            blokInput.value = val;
            suggestionBox.classList.add('hidden');
            triggerBlokLookup();
          }
        }
      });
    }

    const hunianRadios = document.querySelectorAll('input[name="hunian"]');

    let bulanCount = 0;
    let rate = 0;

    // ===== UTIL =====
    function setTodayDate() {
      const tanggalInput = document.getElementById('tanggal');
      if (!tanggalInput) return;

      const today = new Date();
      tanggalInput.value = formatDateISO(today);
      tanggalInput.dispatchEvent(new Event('change'));
      _updateTanggalUI_();
    }

    function onTanggalChange() {
      _updateTanggalUI_();
    }

    function _updateTanggalUI_() {
      const tanggalInput  = document.getElementById('tanggal');
      const container     = document.getElementById('tanggalContainer');
      const badge         = document.getElementById('tanggalTodayBadge');
      const display       = document.getElementById('tanggalDisplay');
      const helperText    = document.getElementById('tanggalHelperText');
      if (!tanggalInput) return;

      const val     = tanggalInput.value;
      const today   = formatDateISO(new Date());
      const isToday = val === today;
      const hasVal  = !!val;

      // Format display: "31 May 2026"
      if (display) {
        if (hasVal) {
          const [y, m, d] = val.split('-');
          const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          display.innerText = d + ' ' + (months[parseInt(m,10)-1] || m) + ' ' + y;
          display.classList.remove('text-gray-400');
          display.classList.add('text-gray-800');
        } else {
          display.innerText = 'Pilih tanggal';
          display.classList.remove('text-gray-800');
          display.classList.add('text-gray-400');
        }
      }

      // Container border & bg
      if (hasVal) {
        container.classList.remove('bg-gray-50', 'border-gray-200');
        container.classList.add('bg-white', 'border-primary/40');
      } else {
        container.classList.remove('bg-white', 'border-primary/40');
        container.classList.add('bg-gray-50', 'border-gray-200');
      }

      // Badge "✓ Hari ini"
      if (badge) {
        if (isToday) {
          badge.classList.remove('hidden');
          badge.classList.add('flex');
        } else {
          badge.classList.add('hidden');
          badge.classList.remove('flex');
        }
      }

      // Helper text
      if (helperText) {
        if (isToday) {
          helperText.innerText = 'Tanggal hari ini sudah diisi otomatis. Ubah jika transfer dilakukan sebelumnya.';
          helperText.classList.remove('text-gray-400');
          helperText.classList.add('text-primary/70');
        } else if (hasVal) {
          helperText.innerText = 'Pastikan tanggal sesuai bukti transfer Anda.';
          helperText.classList.remove('text-primary/70');
          helperText.classList.add('text-gray-400');
        } else {
          helperText.innerText = 'Isi sesuai tanggal transfer di bukti pembayaran Anda.';
          helperText.classList.remove('text-primary/70');
          helperText.classList.add('text-gray-400');
        }
      }

      updateSubmitButtonState();
    }

    function formatRupiah(value) {
      const number = value.replace(/[^\d]/g, '');
      if (!number) return 'Rp 0';
      return 'Rp ' + Number(number).toLocaleString('id-ID');
    }

    function getNumber(value) {
      return Number(value.replace(/[^\d]/g, '')) || 0;
    }

    function formatDateISO(date) {
      return date.toISOString().split('T')[0];
    }

    function formatDateHuman(date) {
      return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }

    function getHouseCount() {
      const val = blokInput.value || '';
      return val
        .split(',')
        .map(b => b.trim())
        .filter(Boolean)
        .length || 1;
    }

    function updateChipStates_() {
      if (!selectedYear) return;

      var now = new Date();
      var currentYear  = now.getFullYear();
      var currentMonth = now.getMonth();
      var currentDay   = now.getDate();

      var yr      = parseInt(selectedYear, 10);
      var paid    = (wargaPaidMonths    && wargaPaidMonths[yr])    ? wargaPaidMonths[yr]    : [];
      var pending = (wargaPendingMonths && wargaPendingMonths[yr]) ? wargaPendingMonths[yr] : [];

      // Hanya tampilkan selected state untuk tahun yang sedang aktif (selectedYear)
      var selectedInThisYear = selectedMonthsByYear[selectedYear] || [];

      var monthChips = document.querySelectorAll('#bulanChips .chip');
      monthChips.forEach(function(chip, idx) {

        // Reset semua state dulu
        chip.classList.remove('active');
        chip.disabled = false;
        chip.style.background  = '';
        chip.style.color       = '';
        chip.style.borderColor = '';
        chip.style.opacity     = '';
        chip.style.cursor      = '';
        chip.style.boxShadow   = '';
        chip.removeAttribute('data-pending-label');

        // Sudah bayar di tahun ini → grey, tidak bisa dipilih
        if (paid.includes(idx)) {
          chip.disabled = true;
          chip.style.background  = '#f3f4f6';
          chip.style.color       = '#9ca3af';
          chip.style.borderColor = '#e5e7eb';
          chip.style.cursor      = 'not-allowed';
          chip.style.opacity     = '0.6';
          return;
        }

        // Masih Pending (menunggu konfirmasi admin) → orange, tidak bisa dipilih
        if (pending.includes(idx)) {
          chip.disabled = false; // jangan disabled agar click bisa ditangkap
          chip.style.background  = '#fffbeb';
          chip.style.color       = '#d97706';
          chip.style.borderColor = '#fcd34d';
          chip.style.cursor      = 'not-allowed';
          chip.style.opacity     = '0.85';
          chip.setAttribute('data-pending', '1');
          return;
        }
        chip.removeAttribute('data-pending');

        // Cek overdue untuk tahun yang sedang ditampilkan
        var isOverdue = false;
        if (yr < currentYear) {
          isOverdue = true;
        } else if (yr === currentYear) {
          // jatuh tempo = tgl 5 bulan berikutnya
          var dueMonth = idx + 1; // 0-based bulan berikutnya
          if (dueMonth < currentMonth) {
            isOverdue = true;
          } else if (dueMonth === currentMonth && currentDay > 5) {
            isOverdue = true;
          }
        }

        // Tampilkan warna overdue (belum bayar, belum dipilih)
        if (isOverdue) {
          chip.style.background  = '#fff1f2';
          chip.style.color       = '#e11d48';
          chip.style.borderColor = '#fda4af';
        }

        // Tampilkan selected state HANYA untuk selectedYear aktif
        if (selectedInThisYear.includes(idx)) {
          chip.classList.add('active');
          if (isOverdue) {
            chip.style.background  = '#be123c';
            chip.style.color       = '#ffffff';
            chip.style.borderColor = '#9f1239';
            chip.style.boxShadow   = '0 0 0 2px #fda4af';
          }
        }
      });

      // Chip tahun — grey jika semua 12 bulan lunas
      document.querySelectorAll('.chip-year').forEach(function(btn) {
        var y = parseInt(btn.textContent.trim(), 10);
        var p = (wargaPaidMonths && wargaPaidMonths[y]) ? wargaPaidMonths[y] : [];
        if (p.length >= 12) {
          btn.disabled = true;
          btn.style.opacity = '0.4';
          btn.style.cursor  = 'not-allowed';
        } else {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor  = '';
        }
      });
    }

    // ===== AUTO CALC =====
    function updateNominalAuto() {
      if (manualCheckbox.checked) return;

      // WAJIB: hunian & bulan harus ada
      if (!selectedRate || !bulanCount) {
        nominalInput.value = 'Rp 0';
        return;
      }

      const houseCount = getHouseCount();
      const total = selectedRate * houseCount * bulanCount;

      nominalInput.value = formatRupiah(String(total));
    }

    function updateNominalBreakdown_() {
      var nominalEl   = document.getElementById('nominal');
      var breakdownEl = document.getElementById('nominalBreakdown');
      if (!nominalEl) return;

      if (manualCheckbox && manualCheckbox.checked) return;

      if (!selectedRate || selectedRate <= 0) {
        nominalEl.value = 'Rp 0';
        if (breakdownEl) breakdownEl.innerHTML = '';
        return;
      }

      var houseCount   = 1; // rate sudah di-merge per blok di backend
      var grandTotal   = 0;
      var breakdownHtml = '';
      var monthNames   = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

      var years = Object.keys(selectedMonthsByYear).sort();

      years.forEach(function(yr) {
        var months = selectedMonthsByYear[yr] || [];
        if (!months.length) return;

        var yrInt = parseInt(yr, 10);
        // Jika user override untuk tahun ini → pakai override, ignore wargaRateByMonth
        var overrideForYear = userOverrideRateByYear[yr] || null;
        var rateMap = (!overrideForYear && wargaRateByMonth && wargaRateByMonth[yrInt])
          ? wargaRateByMonth[yrInt]
          : null;

        // Group bulan berdasarkan rate-nya
        var rateGroups = {}; // { '200000': [0,1,2], '175000': [2,3] }

        months.forEach(function(mIdx) {
          var rate = 0;

          if (overrideForYear) {
            // User sudah manual pilih hunian — pakai override
            rate = overrideForYear;
          } else if (rateMap) {
            // Cek rateByMonth per bulan spesifik (dari helper AK-AP di sheet)
            var key = yrInt + '_' + mIdx;
            if (rateMap[key] && rateMap[key] > 0) {
              rate = rateMap[key];
            }
          }

          // Fallback: kolom E via selectedRate
          if (!rate) rate = selectedRate;
          if (!rateGroups[rate]) rateGroups[rate] = [];
          rateGroups[rate].push(mIdx);
        });

        // Render breakdown per rate group per tahun
        Object.keys(rateGroups).forEach(function(rate) {
          var rateNum  = Number(rate);
          var mIdxs    = rateGroups[rate];
          var subtotal = rateNum * houseCount * mIdxs.length;
          grandTotal  += subtotal;

          var labels = mIdxs.map(function(i){ return monthNames[i]; }).join(', ');

          // Tampilkan breakdown per blok jika multi-blok
          var bloksArr = (wargaRateByMonth && window._wargaBloks_) ? window._wargaBloks_ : null;
          if (bloksArr && bloksArr.length > 1) {
            // Render per blok
            bloksArr.forEach(function(blokName) {
              // Ambil rate blok ini dari rateByBlokMonth[blokName][yr]
              var blokRate = rateNum / bloksArr.length; // fallback equal split
              if (window._rateByBlokMonth_ && window._rateByBlokMonth_[blokName]) {
                var brmYear = window._rateByBlokMonth_[blokName][yrInt] || window._rateByBlokMonth_[blokName];
                var key0 = yrInt + '_' + mIdxs[0];
                if (brmYear && brmYear[key0]) blokRate = brmYear[key0];
              }
              var blokSubtotal = blokRate * mIdxs.length;
              breakdownHtml +=
                '<div class="flex justify-between text-xs text-gray-500 mt-1">' +
                  '<span>' + labels + ' ' + yr + ' (' + blokName + ')</span>' +
                  '<span>Rp ' + Number(blokSubtotal).toLocaleString('id-ID') + '</span>' +
                '</div>';
            });
          } else {
            breakdownHtml +=
              '<div class="flex justify-between text-xs text-gray-500 mt-1">' +
                '<span>' + labels + ' ' + yr + '</span>' +
                '<span>Rp ' + Number(subtotal).toLocaleString('id-ID') + '</span>' +
              '</div>';
          }
        });
      });

      nominalEl.value = grandTotal > 0
        ? 'Rp ' + Number(grandTotal).toLocaleString('id-ID')
        : 'Rp 0';

      if (breakdownEl) breakdownEl.innerHTML = breakdownHtml;
    }

    function applyPaidMonthsData_(res) {
      if (!res || !res.ok) return;

      wargaPaidMonths    = res.paid;
      wargaPendingMonths = res.pending || null;
      wargaRateByMonth   = res.rateByMonth || null;
      window._wargaBloks_ = res.bloks || null;
      window._rateByBlokMonth_ = res.rateByBlokMonth || null;

      // === 1) Set rate & hunian card ===
      // Priority 1: defaultRate dari server (sudah hitung AK-AP + fallback E)
      var rateToApply = (res.defaultRate && res.defaultRate > 0) ? res.defaultRate : 0;

      // Priority 2 (hanya jika server tidak kirim defaultRate): cari dari rateByMonth
      // Cari bulan pertama yang belum bayar di tahun berjalan
      if (!rateToApply && wargaRateByMonth) {
        var nowYr2  = new Date().getFullYear();
        var nowMon2 = new Date().getMonth();
        var paidNow2 = (wargaPaidMonths && wargaPaidMonths[nowYr2]) ? wargaPaidMonths[nowYr2] : [];
        var rMap2 = wargaRateByMonth[nowYr2] || {};
        // Cari dari bulan yg belum bayar mulai bulan ini
        for (var mi2b = nowMon2; mi2b < 12; mi2b++) {
          if (!paidNow2.includes(mi2b)) {
            var rk2 = nowYr2 + '_' + mi2b;
            if (rMap2[rk2] && rMap2[rk2] > 0) {
              rateToApply = rMap2[rk2];
              break;
            }
          }
        }
        // Cari bulan sebelumnya (overdue) jika belum ketemu
        if (!rateToApply) {
          for (var mi2c = 0; mi2c < nowMon2; mi2c++) {
            if (!paidNow2.includes(mi2c)) {
              var rk2c = nowYr2 + '_' + mi2c;
              if (rMap2[rk2c] && rMap2[rk2c] > 0) {
                rateToApply = rMap2[rk2c];
                break;
              }
            }
          }
        }
      }

      if (rateToApply > 0) {
        selectedRate = rateToApply;
        rate = selectedRate;

        // Cek apakah semua blok punya rate sama — baca dari res langsung
        var bloksArr2 = (res.bloks && res.bloks.length) ? res.bloks : [];
        var rateByBlokMap2 = res.rateByBlokMonth || null;
        var yr2 = new Date().getFullYear();
        var nowM2 = new Date().getMonth();

        var allRates2 = bloksArr2.map(function(b) {
          if (rateByBlokMap2 && rateByBlokMap2[b] && rateByBlokMap2[b][yr2]) {
            return rateByBlokMap2[b][yr2][yr2 + '_' + nowM2] || 0;
          }
          return 0;
        }).filter(function(r) { return r > 0; });

        var allSameRate = bloksArr2.length <= 1 ||
          allRates2.length === 0 ||
          allRates2.every(function(r) { return r === allRates2[0]; });

        // Per-house rate: selectedRate might be total when multi-house
        var _blokCount2 = Math.max(bloksArr2.length, 1);
        var _perHouseRate2 = allRates2.length > 0
          ? allRates2[0]
          : Math.round(selectedRate / _blokCount2);

        document.querySelectorAll('.hunian-card').forEach(function(card) {
          card.classList.remove('active');
          if (!allSameRate) {
            // Rate berbeda antar blok — disable card, tampilkan tooltip
            card.disabled = true;
            card.style.opacity = '0.4';
            card.style.cursor = 'not-allowed';
            card.title = 'Tarif IPL berbeda antar rumah — tidak dapat diubah manual';
          } else {
            // Rate sama — enable normal, select matching card
            card.disabled = false;
            card.style.opacity = '';
            card.style.cursor = '';
            card.title = '';
            var cardVal = Number(card.dataset.value);
            // Match against per-house rate (primary) OR selectedRate directly (single house)
            if (cardVal === _perHouseRate2 || cardVal === selectedRate) {
              card.classList.add('active');
            }
          }
        });
      }

      // === 2) Set tahun chip ===
      var currentYearStr = String(new Date().getFullYear());
      selectedYear = currentYearStr;
      document.querySelectorAll('.chip-year').forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.textContent.trim() === currentYearStr) {
          btn.classList.add('active');
        }
      });

      // Init selectedMonthsByYear untuk tahun ini jika belum ada
      if (!selectedMonthsByYear[selectedYear]) {
        selectedMonthsByYear[selectedYear] = [];
      }

      // === 2.5) Hapus bulan pending & paid dari selectedMonthsByYear ===
      // Agar auto-suggest tidak pre-select bulan yg sudah disubmit / sudah lunas
      Object.keys(selectedMonthsByYear).forEach(function(yr) {
        var yrN = parseInt(yr, 10);
        var paidY    = (wargaPaidMonths    && wargaPaidMonths[yrN])    ? wargaPaidMonths[yrN]    : [];
        var pendingY = (wargaPendingMonths && wargaPendingMonths[yrN]) ? wargaPendingMonths[yrN] : [];
        selectedMonthsByYear[yr] = selectedMonthsByYear[yr].filter(function(m) {
          return !paidY.includes(m) && !pendingY.includes(m);
        });
      });

      // === 3) Update chip states (paid=grey, pending=orange, overdue=merah) ===
      updateChipStates_();

      // === 4) Auto-suggest bulan pertama yang belum bayar ===
      var autoYear = selectedYear;
      var yrInt    = parseInt(autoYear, 10);
      var paidInYear = (wargaPaidMonths && wargaPaidMonths[yrInt]) ? wargaPaidMonths[yrInt] : [];

      var now3        = new Date();
      var currentYear3 = now3.getFullYear();
      var currentMonth3 = now3.getMonth(); // 0-based (Mar = 2)

      // Untuk tahun berjalan: suggest s.d. bulan depan (inklusif)
      // agar upcoming bulan berikutnya setelah terakhir bayar ter-suggest
      var maxSuggestMonth = (yrInt === currentYear3) ? Math.min(currentMonth3 + 1, 11) : 11;

      var pendingInYear = (wargaPendingMonths && wargaPendingMonths[yrInt]) ? wargaPendingMonths[yrInt] : [];

      var firstUnpaid = -1;
      // Loop dari bulan 0 untuk catch tunggakan lama
      // Loop sampai maxSuggestMonth+1 untuk catch upcoming
      for (var mi3 = 0; mi3 <= maxSuggestMonth; mi3++) {
        if (!paidInYear.includes(mi3) && !pendingInYear.includes(mi3)) {
          firstUnpaid = mi3;
          break;
        }
      }
      // Jika semua bulan 0..maxSuggestMonth sudah bayar/pending,
      // suggest bulan berikutnya (upcoming) jika masih dalam tahun berjalan
      if (firstUnpaid === -1 && yrInt === currentYear3 && maxSuggestMonth < 11) {
        var nextMonth = maxSuggestMonth + 1;
        if (!paidInYear.includes(nextMonth) && !pendingInYear.includes(nextMonth)) {
          firstUnpaid = nextMonth;
        }
      }

      if (firstUnpaid >= 0) {
        if (!selectedMonthsByYear[autoYear].includes(firstUnpaid)) {
          selectedMonthsByYear[autoYear].push(firstUnpaid);
          selectedMonthsByYear[autoYear].sort(function(a,b){return a-b;});
        }

        bulanCount = Object.values(selectedMonthsByYear)
          .reduce(function(s, arr){ return s + arr.length; }, 0);

        // Re-render chip + nominal + submit button
        updateChipStates_();
        updateNominalBreakdown_();
        updateSubmitButtonState();
      } else {
        // Semua bulan sudah bayar — update breakdown saja
        updateNominalBreakdown_();
        updateSubmitButtonState();
      }
    }

    // ===== BULAN CHIP =====
    chips.forEach(function(chip, idx) {
      chip.addEventListener('click', function() {
        if (chip.disabled) return;

        // Chip pending — tampilkan hint, jangan proses
        if (chip.getAttribute('data-pending') === '1') {
          var ex = document.getElementById('pendingChipBubble');
          if (ex) return;
          var b = document.createElement('div');
          b.id = 'pendingChipBubble';
          b.style.cssText = [
            'position:fixed','bottom:100px','left:50%',
            'transform:translateX(-50%)',
            'background:#1f2937','color:#fff',
            'font-size:13px','font-weight:500',
            'padding:10px 18px','border-radius:12px',
            'white-space:nowrap','z-index:99999',
            'opacity:0','transition:opacity 0.2s ease',
            'pointer-events:none'
          ].join(';');
          b.innerText = 'Menunggu verifikasi admin';
          document.body.appendChild(b);
          requestAnimationFrame(function(){ b.style.opacity = '1'; });
          setTimeout(function(){
            b.style.opacity = '0';
            setTimeout(function(){ if (b.parentNode) b.parentNode.removeChild(b); }, 200);
          }, 2500);
          return;
        }

        if (!selectedYear) {
          showToast('Pilih tahun terlebih dahulu', 'error');
          return;
        }

        chip.classList.toggle('active');

        // sync ke selectedMonthsByYear
        if (!selectedMonthsByYear[selectedYear]) {
          selectedMonthsByYear[selectedYear] = [];
        }

        if (chip.classList.contains('active')) {
          if (!selectedMonthsByYear[selectedYear].includes(idx)) {
            selectedMonthsByYear[selectedYear].push(idx);
            selectedMonthsByYear[selectedYear].sort(function(a,b){return a-b;});
          }
        } else {
          selectedMonthsByYear[selectedYear] =
            selectedMonthsByYear[selectedYear].filter(function(i){ return i !== idx; });
        }

        bulanCount = Object.values(selectedMonthsByYear)
          .reduce(function(s,arr){ return s + arr.length; }, 0);

        updateChipStates_();
        updateNominalBreakdown_();
        _syncHunianCardToSelectedMonths_();
        updateSubmitButtonState();
      });
    });

    // ===== STATUS HUNIAN =====
    hunianRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        rate = Number(radio.value);
        updateNominalAuto();
      });
    });

    // ===== TAHUN DIBAYAR (SINGLE SELECT) =====
    document.querySelectorAll('.chip-year').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.disabled) return;

        // toggle active — boleh multi-tahun
        btn.classList.toggle('active');

        var yr = btn.textContent.trim();

        if (btn.classList.contains('active')) {
          selectedYear = yr;
          if (!selectedMonthsByYear[yr]) {
            selectedMonthsByYear[yr] = [];
          }

          // Set default rate untuk tahun ini
          // Prioritas: userOverride → wargaRateByMonth bulan pertama belum bayar → selectedRate
          if (!userOverrideRateByYear[yr]) {
            var yrInt = parseInt(yr, 10);
            var paidInYr = (wargaPaidMonths && wargaPaidMonths[yrInt]) ? wargaPaidMonths[yrInt] : [];
            var rMap = (wargaRateByMonth && wargaRateByMonth[yrInt]) ? wargaRateByMonth[yrInt] : null;
            var defaultRateForYr = selectedRate;

            if (rMap) {
              for (var m = 0; m < 12; m++) {
                if (!paidInYr.includes(m)) {
                  var key = yrInt + '_' + m;
                  if (rMap[key] && rMap[key] > 0) {
                    defaultRateForYr = rMap[key];
                    break;
                  }
                }
              }
            }

            selectedRate = defaultRateForYr;
            rate = selectedRate;

            // Update hunian card UI
            var _bc3 = (window._wargaBloks_ && window._wargaBloks_.length > 1) ? window._wargaBloks_.length : 1;
            var _perHouse3 = Math.round(selectedRate / _bc3);
            document.querySelectorAll('.hunian-card').forEach(function(card) {
              card.classList.remove('active');
              var _cv3 = Number(card.dataset.value);
              if (_cv3 === _perHouse3 || _cv3 === selectedRate) {
                card.classList.add('active');
              }
            });
          }
        } else {
          // deselect tahun → hapus bulan di tahun itu
          delete selectedMonthsByYear[yr];
          // set selectedYear ke tahun aktif lainnya
          var activeYears = Array.from(
            document.querySelectorAll('.chip-year.active')
          ).map(function(b){ return b.textContent.trim(); });
          selectedYear = activeYears.length ? activeYears[activeYears.length - 1] : null;
        }

        // sync chip bulan ke selectedYear terakhir
        updateChipStates_();
        updateNominalBreakdown_();
        updateSubmitButtonState();
      });
    });

    // ===== STATUS HUNIAN (CARD BUTTON) =====
    document.querySelectorAll('.hunian-card').forEach(card => {
      card.addEventListener('click', () => {

        // reset semua
        document.querySelectorAll('.hunian-card')
          .forEach(c => c.classList.remove('active'));

        // set aktif
        card.classList.add('active');

        selectedRate = Number(card.dataset.value) || 0;
        rate = selectedRate;
        if (selectedYear) {
          userOverrideRateByYear[selectedYear] = selectedRate;
        }
        updateNominalBreakdown_();
        updateSubmitButtonState();
      });
    });

    // ===== MANUAL TOGGLE =====
    manualCheckbox.addEventListener('change', () => {
      if (manualCheckbox.checked) {
        nominalInput.readOnly = false;
        nominalInput.classList.remove('bg-gray-100');
        nominalInput.classList.add('bg-white');
        nominalInput.value = '';
        nominalInput.focus();
      } else {
        nominalInput.readOnly = true;
        nominalInput.classList.add('bg-gray-100');
        nominalInput.classList.remove('bg-white');
        updateNominalAuto();
      }
      updateSubmitButtonState();
    });

    // ===== FORMAT MANUAL INPUT =====
    nominalInput.addEventListener('input', () => {
      if (!manualCheckbox.checked) return;
      nominalInput.value = formatRupiah(nominalInput.value);
      updateSubmitButtonState();
    });

    // ===== SHEET CONTROL =====
    function openSheet() {
      console.log('OPEN SHEET USER:', currentUser);
      setActiveNavById('navFabBayarBtn');
      // ===== PUSH HISTORY STATE (ANDROID BACK SUPPORT) =====
      if (!history.state || !history.state.sheet) {
        history.pushState({ sheet: true }, '');
      }
      resetIdentityFields();
      resetUploadSection();
      document.body.classList.add('ipl-form-open');

      // 🔥 RESET lookup & decision state (WAJIB)
      isLookupLocked = false;
      multiDecisionMode = null;
      residentSuggestion = null;

      // For admin: show picker FIRST, sheet revealed after selection
      if (currentUser && currentUser.role === 'admin') {
        const identitySection2 = document.getElementById('identitySection');
        if (identitySection2) identitySection2.classList.remove('hidden');
        openAdminBayarPicker();
        return;
      }

      const sheet = document.getElementById('sheet');
      const overlay = document.getElementById('overlay');

      sheet.scrollTop = 0;
      sheet.classList.remove('translate-y-[120%]');
      overlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden';

      /* ================= RESET STATE ================= */
      selectedYear = null;
      selectedRate = 0;
      bulanCount = 0;
      selectedMonthsByYear = {};

      /* ================= RESET UI ================= */

      // reset tahun
      document.querySelectorAll('.chip-year.active')
        .forEach(b => b.classList.remove('active'));

      // reset hunian
      document.querySelectorAll('.hunian-card.active')
        .forEach(c => c.classList.remove('active'));

      // reset bulan
      document.querySelectorAll('.chip.active')
        .forEach(c => c.classList.remove('active'));

      // reset nominal
      if (nominalInput) {
        nominalInput.value = 'Rp 0';
      }

      /* ================= TANGGAL ================= */
      const tanggalInput = document.getElementById('tanggal');
      if (tanggalInput) {
        if (!tanggalInput.value) tanggalInput.value = formatDateISO(new Date());
        _updateTanggalUI_();
      }

      /* ================= FOCUS (TERAKHIR) ================= */
      /* setTimeout(() => {
        if (tanggalInput) {
          tanggalInput.focus();
          tanggalInput.click();
        }
      }, 300); */
      
      /* ================= LOGIN MODE HANDLING ================= */
      const identitySection = document.getElementById('identitySection');

      // (admin handled earlier — picker shown first)

      if (currentUser && currentUser.role !== 'admin') {
        // Warga biasa → auto-fill & hide identity
        if (!Array.isArray(currentUser.wargaData) || !currentUser.wargaData.length) {
          gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
            .then(function(dataRes) {
              if (dataRes && dataRes.success) {
                currentUser.wargaData = dataRes.data || [];
              }
              openSheet();
            });
          return;
        }

        fillIdentityFromWargaData_();
        if (identitySection) identitySection.classList.add('hidden');
        // TIDAK return — lanjut ke load paid months
      }

      // Tidak login (hanya jika currentUser null)
      if (!currentUser) {
        if (identitySection) identitySection.classList.remove('hidden');
      }

      // Load paid months jika login — gunakan cache jika sudah ada
      if (currentUser && currentUser.email) {
        if (wargaPaidMonths && wargaRateByMonth) {
          // Cache hit — langsung apply tanpa fetch
          applyPaidMonthsData_({
            ok: true,
            paid: wargaPaidMonths,
            pending: wargaPendingMonths || {},
            rateByMonth: wargaRateByMonth,
            defaultRate: currentUser._cachedDefaultRate || 0,
            bloks: window._wargaBloks_ || [],
            rateByBlokMonth: window._rateByBlokMonth_ || null
          });
        } else {
          showDetailPaymentSkeleton_(true);
          gasGet_('getWargaPaidMonths', { email: currentUser.email })
            .then(function(res) {
              showDetailPaymentSkeleton_(false);
              console.log('[paidMonths] response:', JSON.stringify(res));
              if (!res || !res.ok) return;
              wargaPaidMonths = res.paid;
              wargaRateByMonth = res.rateByMonth || null;
              if (currentUser) currentUser._cachedDefaultRate = res.defaultRate || 0;
              applyPaidMonthsData_(res);
            })
            .catch(function() {
              showDetailPaymentSkeleton_(false);
            });
        }
      }
    }

    function closeSheet() {
      resetIdentityFields();
      
      // JANGAN null-kan wargaPaidMonths — cache tetap hidup untuk open berikutnya
      userOverrideRateByYear = {};
      selectedMonthsByYear = {};
      userOverrideRateByYear = {};
      
      var summaryCard = document.getElementById('identitySummaryCard');
      if (summaryCard) summaryCard.classList.add('hidden');
      
      document.body.classList.remove('ipl-form-open');
      const sheet = document.getElementById('sheet');
      const overlay = document.getElementById('overlay');
      sheet.classList.remove('translate-y-[120%]');
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
    }

    const uploadInput = document.getElementById('buktiUpload');
    if (uploadInput) {
      uploadInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        startUploadProgress(file);
      });
    }

    const uploadText = document.getElementById('uploadText');
    const previewContainer = document.getElementById('previewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const pdfPreview = document.getElementById('pdfPreview');
    const pdfName = document.getElementById('pdfName');

    function setActiveNav(el) {
      document.querySelectorAll('.nav-app')
        .forEach(n => n.classList.remove('active'));
      el.classList.add('active');
    }

    function comingSoon() {
      document.getElementById('comingSoon').classList.remove('hidden');
    }

    function closeComingSoon() {
      document.getElementById('comingSoon').classList.add('hidden');
    }

    function disableSubmit() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      btn.disabled = true;
      btn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="white" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="white" stroke-width="3"
              fill="none"/>
          </svg>
          Submitting...
        </span>
      `;
    }

    function enableSubmit() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      btn.disabled = false;
      btn.innerHTML = 'Kirim Konfirmasi Pembayaran';
    }

    function successIcon() {
      return `
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M5 13l4 4L19 7" />
        </svg>
      `;
    }

    function errorIcon() {
      return `
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
    }

    /* ================= SUBMIT FORM ================= */
    function submitForm() {
      disableSubmit();

      const namaEl = document.getElementById('nama');
      const emailEl = document.getElementById('email');
      const hpEl = document.getElementById('noHp');

      const payload = {
        nama: (namaEl && namaEl.dataset.fullValue) || (namaEl && namaEl.value) || '',
        blokRumah: (document.getElementById('blok') && document.getElementById('blok').value) || '',
        email: (emailEl && emailEl.dataset.fullValue) || (emailEl && emailEl.value) || '',
        noHp: (hpEl && hpEl.dataset.fullValue) || (hpEl && hpEl.value) || '',

        statusTinggal: (function() {
          var activeCard = document.querySelector('.hunian-card.active');
          if (activeCard) return Number(activeCard.dataset.value) === 200000 ? 'Rumah Dihuni' : 'Rumah Tidak Dihuni';
          // Fallback: derive per-house rate from selectedRate / blok count
          var _bc = (window._wargaBloks_ && window._wargaBloks_.length > 1) ? window._wargaBloks_.length : 1;
          return Math.round(selectedRate / _bc) >= 190000 ? 'Rumah Dihuni' : 'Rumah Tidak Dihuni';
        })(),

        rate: selectedRate,
        tahun: Object.keys(selectedMonthsByYear).sort()[0] || selectedYear,
        bulan: Object.values(selectedMonthsByYear).reduce(function(a,b){ return a.concat(b); }, [])
          .map(function(i){
            return ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][i];
          }),

        // Multi-tahun payload
        bulanPerTahun: (function() {
          var result = {};
          var monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          Object.keys(selectedMonthsByYear).forEach(function(yr) {
            result[yr] = (selectedMonthsByYear[yr] || []).map(function(i){ return monthNames[i]; });
          });
          return result;
        })(),

        nominalPerTahun: (function() {
          var result = {};
          var houseCount = 1; // rate sudah di-merge per blok di backend
          Object.keys(selectedMonthsByYear).forEach(function(yr) {
            var yrInt  = parseInt(yr, 10);
            var months = selectedMonthsByYear[yr] || [];
            var overrideForYear = userOverrideRateByYear[yr] || null;
            var rateMap = (!overrideForYear && wargaRateByMonth && wargaRateByMonth[yrInt])
              ? wargaRateByMonth[yrInt]
              : null;
            var total  = 0;
            months.forEach(function(mIdx) {
              var rate = overrideForYear || selectedRate;
              if (rateMap) {
                var key = yrInt + '_' + mIdx;
                if (rateMap[key] && rateMap[key] > 0) rate = rateMap[key];
              }
              total += rate * houseCount;
            });
            result[yr] = total;
          });
          return result;
        })(),

        nominal: Number(
          ((document.getElementById('nominal') && document.getElementById('nominal').value) || '').replace(/[^\d]/g, '')
        ),

        bank: (document.getElementById('bank') && document.getElementById('bank').value) || '',
        rekening: (document.getElementById('rekening') && document.getElementById('rekening').value) || '',
        keterangan: (document.getElementById('keterangan') && document.getElementById('keterangan').value) || '',
        buktiUrl: uploadedFile || '',

        multiRumah: ((document.getElementById('blok') && document.getElementById('blok').value) || '').includes(','),

        manualOverride: {
          nama: !(namaEl && namaEl.dataset.autofilled),
          email: !(emailEl && emailEl.dataset.autofilled),
          noHp: !(hpEl && hpEl.dataset.autofilled)
        },

        tanggalBayar: (document.getElementById('tanggal') && document.getElementById('tanggal').value) || '',
      };

      // ===== FORCE SESSION DATA UNTUK WARGA =====
      if (currentUser && currentUser.role === 'warga' && currentUser.wargaData) {

        const first = currentUser.wargaData[0];

        payload.nama = first.nama || payload.nama;
        payload.email = first.email || currentUser.email;
        payload.noHp = first.noHp || payload.noHp;

        payload.blokRumah = currentUser.wargaData
          .map(d => d.blok)
          .join(', ');
      }

      gasPost_('submitIPLForm', { payload: payload })
        .then(function(res) {
          enableSubmit();
          if (res && res.success === false) {
            if (res.duplicate) {
              showToast(res.message || 'Kamu sudah punya submission yang masih Pending untuk bulan ini.', 'error');
            } else {
              showToast(res.message || 'Gagal menyimpan data, silakan coba lagi.', 'error');
            }
            return;
          }
          var _bulanNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
          var _periodeStr = (payload.bulanPerTahun
            ? Object.entries(payload.bulanPerTahun)
                .map(function(e){ return e[1].join(', ') + ' ' + e[0]; })
                .join(' | ')
            : (payload.bulan || []).map(function(b){ return _bulanNames[b] || b; }).join(', ') + ' ' + (payload.tahun || '')
          ).trim();
          var _nominalStr = 'Rp ' + Number(payload.nominal || 0).toLocaleString('id-ID');
          showPaymentSuccessBanner({
            nama   : payload.nama,
            blok   : payload.blokRumah,
            periode: _periodeStr,
            nominal: _nominalStr
          });
          resetForm();
          setTimeout(function() {
            closeSheet();
            openHome();
          }, 600);
        })
        .catch(function(err) {
          console.error('Submit error:', err);
          showToast('Gagal menyimpan data, silakan coba lagi.','error');
          enableSubmit();
        });
    }

    /* ================= RESET ================= */
    function resetUploadSection() {

      // reset state variable
      uploadedFile = null;

      // revoke object URL jika ada
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }

      // hide preview container
      const preview = document.getElementById('previewContainer');
      if (preview) preview.classList.add('hidden');

      // reset image
      const img = document.getElementById('imagePreview');
      if (img) {
        img.src = '';
        img.classList.add('hidden');
      }

      // reset pdf
      const pdf = document.getElementById('pdfPreview');
      if (pdf) pdf.classList.add('hidden');

      const pdfName = document.getElementById('pdfName');
      if (pdfName) pdfName.textContent = '';

      // reset file input
      const fileInput = document.getElementById('buktiUpload');
      if (fileInput) fileInput.value = '';

      // reset progress bar
      const bar = document.getElementById('uploadBar');
      if (bar) bar.style.width = '0%';

      const percent = document.getElementById('uploadPercent');
      if (percent) percent.innerText = '0%';
    }
    
    function resetForm() {
      /* ================= RESET INPUT ================= */
      document.querySelectorAll('input, textarea').forEach(el => {
        if (el.type === 'radio' || el.type === 'checkbox') {
          el.checked = false;
        } else {
          el.value = '';
        }
      });

      /* ================= RESET CHIP BULAN ================= */
      document.querySelectorAll('.chip.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET CHIP TAHUN ================= */
      document.querySelectorAll('.chip-year.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET HUNIAN ================= */
      document.querySelectorAll('.hunian-card.active')
        .forEach(c => c.classList.remove('active'));

      /* ================= RESET STATE ================= */
      selectedYear = null;
      selectedRate = 0;
      bulanCount = 0;

      /* ================= RESET NOMINAL ================= */
      const nominalEl = document.getElementById('nominal');
      if (nominalEl) nominalEl.value = 'Rp 0';

      /* ================= RESET UPLOAD ================= */
      resetUploadSection();

      /* ================= RESET BUTTON ================= */
      updateSubmitButtonState();
    }

    function checkFormValiditySilent() {

      // input text required
      const blokVal = document.getElementById('blok')?.value || '';
      if(!isValidBlokFormat(blokVal)) return false;
      const inputBloks = blokVal
      .split(',')
      .map(b=>b.trim().toUpperCase())
      .filter(Boolean);

      const allValid = inputBloks.every(b =>
      VALID_BLOK_LIST.includes(b)
      );
      if(!allValid) return false;

      const requiredInputs = document.querySelectorAll(
        'input[data-required="true"], textarea[data-required="true"]'
      );

      for (const el of requiredInputs) {
        if (!el.value || !el.value.trim()) return false;
      }

      // bulan + tahun (multi-tahun)
      var totalSelected = Object.values(selectedMonthsByYear)
        .reduce(function(s,arr){ return s + arr.length; }, 0);
      if (totalSelected === 0) return false;
      if (!Object.keys(selectedMonthsByYear).length) return false;

      // hunian
      if (!selectedRate || selectedRate <= 0) return false;

      // nominal
      const nominalEl = document.getElementById('nominal');
      const nominalVal = (nominalEl && nominalEl.value) || '';
      if (!nominalVal || nominalVal === 'Rp 0') return false;

      // upload
      if (!uploadedFile) return false;

      return true;
    }

    function updateSubmitButtonState() {
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      const isValid = checkFormValiditySilent();

      btn.disabled = !isValid;
    }

    function validateForm() {
      /* ========= RESET ERROR STATE ========= */
      document.querySelectorAll('.field-error')
        .forEach(el => el.classList.remove('field-error'));

      let firstError = null;
      let isValid = true;

      /* ========= RESET STATE VISUAL ========= */
      document
        .querySelectorAll('.border-red-500')
        .forEach(el => el.classList.remove('border-red-500'));

      /* ========= INPUT WAJIB ========= */
      const inputRequired = document.querySelectorAll(
        'input[data-required="true"], textarea[data-required="true"]'
      );

      inputRequired.forEach(el => {
        if (!el.value || !el.value.trim()) {
          isValid = false;
          el.classList.add('border-red-500');
          if (!firstError) firstError = el;
        }
      });

      /* ========= BULAN ========= */
      if (document.querySelectorAll('.chip.active').length === 0) {
        isValid = false;
        const bulanEl = document.getElementById('bulanChips');
        if (bulanEl) bulanEl.classList.add('field-error');
        if (!firstError) firstError = bulanEl;
      }

      /* ========= TAHUN ========= */
      if (!selectedYear) {
        isValid = false;
        const tahunEl = document.getElementById('tahunChips');
        if (tahunEl) tahunEl.classList.add('field-error');
        if (!firstError) firstError = tahunEl;
      }

      /* ========= STATUS HUNIAN ========= */
      if (!selectedRate || selectedRate <= 0) {
        isValid = false;
        const hunianEl = document.getElementById('hunianCards');
        if (hunianEl) hunianEl.classList.add('field-error');
        if (!firstError) firstError = hunianEl;
      }

      /* ========= NOMINAL (HANYA JIKA MANUAL) ========= */
      const manualCheckbox = document.getElementById('manualNominal');
      const nominalEl = document.getElementById('nominal');

      if (manualCheckbox && manualCheckbox.checked) {
        const value = (nominalEl && nominalEl.value || '').replace(/[^\d]/g, '') || '0';

        if (Number(value) <= 0) {
          isValid = false;
          nominalEl.classList.add('border-red-500');
          if (!firstError) firstError = nominalEl;
        }
      }

      /* ========= UPLOAD ========= */
      if (!uploadedFile) {
        isValid = false;
        const uploadEl = document.querySelector('label[for="buktiUpload"]');
        if (uploadEl) uploadEl.classList.add('field-error');
        if (!firstError) firstError = uploadEl;
      }

      /* ========= SCROLL + SHAKE ========= */
      if (!isValid && firstError) {

        // trigger shake
        firstError.classList.add('shake');

        // remove shake agar bisa dipicu ulang
        setTimeout(() => {
          firstError.classList.remove('shake');
        }, 400);

        // scroll ke error
        firstError.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      return isValid;
    }

    function startUploadProgress(file) {

      // VALIDASI UKURAN FILE (WAJIB DI PALING ATAS)
      if (file.size > 5 * 1024 * 1024) {
        showToast('Ukuran file maksimal 5MB','error');
        return;
      }
      
      const progressWrap = document.getElementById('uploadProgress');
      const bar = document.getElementById('uploadBar');
      const percent = document.getElementById('uploadPercent');
      const uploadText = document.getElementById('uploadText');

      uploadText.classList.add('hidden');
      progressWrap.classList.remove('hidden');

      let progress = 0;
      let finished = false;

      const interval = setInterval(() => {
        if (finished) return;

        progress += Math.random() * 10;
        if (progress >= 90) progress = 90;

        bar.style.width = progress + '%';

        // UX hint saat proses server-side
        if (progress >= 85) {
          percent.innerText = 'Menyimpan...';
        } else {
          percent.innerText = Math.floor(progress) + '%';
        }
      }, 300);

      // ⛑️ FAIL-SAFE: auto stop after 60s
      const safetyTimeout = setTimeout(() => {
        if (!finished) {
          clearInterval(interval);
          showToast('Upload memakan waktu terlalu lama, silakan coba ulang.','error');
          progressWrap.classList.add('hidden');
          uploadText.classList.remove('hidden');
        }
      }, 60000);

      const reader = new FileReader();

      reader.onload = e => {
        const base64 = e.target.result.split(',')[1];

        const meta = {
          blok: (document.getElementById('blok') && document.getElementById('blok').value) || '',
          periode: Array.from(document.querySelectorAll('.chip.active'))
            .map(c => c.textContent)
            .join('-'),
          nama: (document.getElementById('nama') && document.getElementById('nama').value) || ''
        };

        gasPost_('uploadBuktiTransfer', {
            base64: base64,
            filename: file.name,
            mimeType: file.type,
            meta: meta
          })
            .then(function(res) {
              finished = true;
              clearInterval(interval);
              clearTimeout(safetyTimeout);
              bar.style.width = '100%';
              percent.innerText = '100%';
              setTimeout(function() {
                progressWrap.classList.add('hidden');
                uploadText.classList.remove('hidden');
                showPreview(file, res.url);
                uploadedFile = res.url;
                updateSubmitButtonState();
              }, 400);
            })
            .catch(function() {
              finished = true;
              clearInterval(interval);
              clearTimeout(safetyTimeout);
              showToast('Upload gagal, silakan coba lagi.','error');
              progressWrap.classList.add('hidden');
              uploadText.classList.remove('hidden');
            });
      };

      reader.readAsDataURL(file);
    }

    function showPreview(file, url) {
      const container = document.getElementById('previewContainer');
      const img = document.getElementById('imagePreview');
      const pdf = document.getElementById('pdfPreview');
      const pdfName = document.getElementById('pdfName');

      container.classList.remove('hidden');

      if (file.type.startsWith('image/')) {
        // 🔥 revoke URL lama jika ada
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
        }
        previewObjectUrl = URL.createObjectURL(file);
        img.src = previewObjectUrl;
        img.classList.remove('hidden');
        pdf.classList.add('hidden');
      } else {
        pdfName.innerText = file.name;
        pdf.classList.remove('hidden');
        img.classList.add('hidden');
      }
    }

    function removeUploadedFile() {
      uploadedFile = null;
      updateSubmitButtonState();

      document.getElementById('previewContainer').classList.add('hidden');
      document.getElementById('uploadBar').style.width = '0%';
      document.getElementById('uploadPercent').innerText = '0%';

      document.getElementById('buktiUpload').value = '';
    }

    function onSubmitClick() {
      if (!validateForm()) return;
      openConfirm();
    }

    function openConfirm() {
      const modal = document.getElementById('confirmModal');
      const text = modal.querySelector('p');

      text.innerText = 'Apakah data pembayaran ini sudah benar?';

      modal.classList.remove('hidden');
    }

    function closeConfirm() {
      document.getElementById('confirmModal').classList.add('hidden');
    }

    function confirmSubmit() {
      closeConfirm();

      // beri 1 frame agar DOM bersih
      requestAnimationFrame(() => {
        submitForm();
      });
    }

    /* ================= SUCCESS TOAST (DASHBOARD) ================= */
    function showToast(message, type = 'success') {

      const toast = document.getElementById('toast');
      const toastInner = document.getElementById('toastInner');

      if (!toast || !toastInner) return;

      const isError   = type === 'error';
      const isWarning = type === 'warning';

      const bg        = isError ? 'bg-red-100'    : isWarning ? 'bg-yellow-100' : 'bg-green-100';
      const iconColor = isError ? 'text-red-600'  : isWarning ? 'text-yellow-600' : 'text-green-600';

      const icon = isError
        ? `<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>`
        : isWarning
        ? `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>`
        : `<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>`;

      toastInner.innerHTML = `
        <div class="w-8 h-8 rounded-full ${bg} flex items-center justify-center">
          <svg class="w-4 h-4 ${iconColor}"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24">
            ${icon}
          </svg>
        </div>

        <div class="flex-1 text-sm font-medium text-gray-800 text-center">
          ${message || ''}
        </div>
      `;

      toast.classList.remove('hidden');
      toast.style.opacity = '1';
      toastInner.classList.remove('opacity-0', 'translate-y-3');
      toastInner.style.opacity = '1';
      toastInner.style.transform = 'translateY(0)';

      if (activeToastTimer) {
        clearTimeout(activeToastTimer);
      }

      activeToastTimer = setTimeout(() => {

        toastInner.style.opacity = '0';
        toastInner.style.transform = 'translateY(12px)';
        toastInner.classList.add('opacity-0', 'translate-y-3');

        setTimeout(() => {
          toast.classList.add('hidden');
          toast.style.opacity = '';
          toastInner.innerHTML = '';
          toastInner.style.opacity = '';
          toastInner.style.transform = '';
        }, 250);

      }, 2200);
    }

    function showSuccessToast(message){
      showToast(message,'success');
    }

    function showErrorToast(message){
      showToast(message,'error');
    }

    function copyToClipboard(text) {

      if (!text || text === '-') return;

      navigator.clipboard.writeText(text)
        .then(() => {
          showToast('ID Pembayaran disalin','success');
        })
        .catch(() => {
          showToast('Gagal menyalin ID','error');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
      updateHeaderAuthUI();
      loadHomeData();
      /* ===============================
        CLOSE SHEET WHEN IPL MENU CLICKED
        =============================== */
      const activeNav = document.querySelector('.nav-active');
      if (activeNav) {
        activeNav.addEventListener('click', () => {
          closeSheet();
        });
      }

      /* ===============================
        PAYMENT SUCCESS BANNER
        Click outside to close
        =============================== */
      const banner = document.getElementById('paymentSuccessBanner');
      if (banner) {
        banner.addEventListener('click', e => {
          // klik hanya area overlay hitam, BUKAN card putih
          if (e.target === banner) {
            closePaymentBanner();
          }
        });
      }

      /* ===============================
        DATE INITIALIZATION (DEFAULT TODAY)
        =============================== */
      const tanggalInput = document.getElementById('tanggal');
      const useToday = document.getElementById('useTodayDate');
      const todayLabel = document.getElementById('todayDateLabel');

      const today = new Date();
      const todayISO = formatDateISO(today);

      // Default tanggal = hari ini
      if (tanggalInput) {
        tanggalInput.value = todayISO;
        _updateTanggalUI_();
      }

      // Label human-readable
      if (todayLabel) {
        todayLabel.textContent = `(${formatDateHuman(today)})`;
      }

      // Toggle "gunakan hari ini"
      if (useToday && tanggalInput) {
        useToday.addEventListener('change', () => {
          if (useToday.checked) {
            tanggalInput.value = todayISO;
          } else {
            tanggalInput.value = '';
            tanggalInput.focus();
          }
        });
      }

      /* ===============================
        SEARCH LISTENER
        =============================== */
      var searchEl = document.getElementById('dashboardSearch');
        if (searchEl) {
          searchEl.addEventListener('input', function () {
            applyFilters();
          });
        }

      // ===== FILTER DATE =====
      document.querySelectorAll('.filter-date-chip').forEach(btn => {
        btn.addEventListener('click', function() {
          const filter = this.dataset.filter || this.innerText.toLowerCase();
          if (filter !== 'custom') {
            document.querySelectorAll('.filter-date-chip')
              .forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            activeTimeFilter = filter;
            customDateRange = null;
            customPanel.classList.add('hidden');
            applyFilters();
          }
        });

      });

      // ===== FILTER BULAN =====
      var monthFilterEl = document.getElementById('monthFilterSelect');
      if (monthFilterEl) {
        monthFilterEl.addEventListener('change', function() {
          applyFilters();
        });
      }

      // ===== FILTER CATEGORY =====
      document.querySelectorAll('.filter-category').forEach(btn => {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.filter-category')
            .forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          activeRateFilter =
            this.innerText.includes('200') ? 200000 : 175000;
          applyFilters();
        });
      });

      const startInput  = document.getElementById('startDateInput');
      const endInput    = document.getElementById('endDateInput');
      const applyBtn    = document.getElementById('applyCustomRangeBtn');
      const clearBtn    = document.getElementById('clearCustomRangeBtn');
      const customBtn   = document.getElementById('customFilterBtn');
      const customPanel = document.getElementById('customRangePanel');

      /* ===== TOGGLE PANEL ===== */
      customBtn?.addEventListener('click', function(e) {
        e.preventDefault();

        const isHidden = customPanel.classList.contains('hidden');

        document.querySelectorAll('.filter-date-chip')
          .forEach(c => c.classList.remove('active'));

        this.classList.add('active');

        customPanel.classList.toggle('hidden', !isHidden);
      });

      /* ===== APPLY ===== */
      applyBtn?.addEventListener('click', function() {

        if (!startInput.value || !endInput.value) {
          alert('Pilih start dan end date');
          return;
        }

        customDateRange = {
          start: startInput.value,
          end: endInput.value
        };

        // 🔥 reset predefined time filter
        activeTimeFilter = 'all';

        customPanel.classList.add('hidden');
        applyFilters();
      });

      /* ===== CLEAR ===== */
      clearBtn?.addEventListener('click', function() {

        startInput.value = '';
        endInput.value   = '';
        customDateRange  = null;
        activeTimeFilter = 'all';

        customPanel.classList.add('hidden');
        applyFilters();
      });

      /* ===============================
        LOGIN REQUIRED → GO TO PAGE SAYA
        =============================== */
      const loginRequiredBtn = document.getElementById('loginRequiredBtn');

      if (loginRequiredBtn) {
        loginRequiredBtn.addEventListener('click', () => {
          closeLoginRequiredModal();
          closeSheet();        // 🔥 tutup sheet dulu
          openPageSaya();      // 🔥 baru buka Saya
        });
      }

      /* ===============================
        READ ONLY NAMA WARGA, EMAIL DAN NP HP
        =============================== */
      const nama = document.getElementById('nama');
      const email = document.getElementById('email');
      const hp = document.getElementById('noHp');

      [nama,email,hp].forEach(el=>{
        if(!el) return;
        el.readOnly = true;
        el.classList.add('bg-gray-100','cursor-not-allowed');
      });

      const updateBtn = document.getElementById('updateDataRedirectBtn');
      if (updateBtn) {
        updateBtn.addEventListener('click', () => {

          if (!currentUser) {
            openLoginRequiredModal('Silakan login untuk memperbarui data Anda.');
            return;
          }

          openPageSaya();
        });
      }
      const namaField = document.getElementById('nama');
      const emailField = document.getElementById('email');
      const hpField = document.getElementById('noHp');

      if (namaField) namaField.readOnly = true;
      if (emailField) emailField.readOnly = true;
      if (hpField) hpField.readOnly = true;
    });

  function openDashboard() {
    if (!currentUser) {
      openLoginRequiredModal();
      return;
    }

    switchPage('dashboard');
    activeTimeFilter = 'all';
    activeRateFilter = null;
    customDateRange = null;
    wargaScoreFilter = 'all';
    _wargaScorecardBound_ = false;


    // ===== PUSH HISTORY STATE =====
    if (!history.state || !history.state.dashboard) {
      history.pushState({ dashboard: true }, '');
    }

    var dashboardEl = document.getElementById('dashboard');
    var loadingEl = document.getElementById('dashboardLoading');
    var errorEl = document.getElementById('dashboardError');

    dashboardEl.classList.remove('hidden');
    errorEl.classList.add('hidden');

    // Scroll to top
    var dashScroll = document.querySelector('#dashboard .flex-1.overflow-y-auto');
    if (dashScroll) dashScroll.scrollTop = 0;

    // 🔥 SET NAV ACTIVE DI SINI (SEBELUM RETURN APAPUN)
    setActiveNavById('navActivity');

    // ===== ROLE-BASED UI =====
    var isAdmin = currentUser && currentUser.role === 'admin';
    var titleEl   = document.getElementById('dashboardTitle');
    var tabRow    = document.getElementById('dashboardTabRow');
    var filterRow = document.getElementById('dashboardFilterRow');

    if (titleEl) titleEl.innerText = isAdmin ? 'Dashboard Verifikasi' : 'Riwayat Pembayaran';
    if (tabRow)    tabRow.classList.toggle('hidden', !isAdmin);
    if (filterRow) filterRow.classList.toggle('hidden', !isAdmin);

    // Warga: default tab confirmed agar semua history tampil
    if (!isAdmin) activeTabType = 'all_warga';

    if (dashboardCache) {
      loadingEl.classList.add('hidden');
      hydrateDashboardFromCache();
      return;
    }

    // Try sessionStorage cache (TTL 3 min) to avoid redundant fetches
    try {
      var _ss = sessionStorage.getItem('dashCache');
      if (_ss) {
        var _parsed = JSON.parse(_ss);
        if (_parsed && (Date.now() - (_parsed._ts || 0)) < 3 * 60 * 1000) {
          dashboardCache = _parsed;
          dashboardPendingCache   = _parsed.pending   || [];
          dashboardConfirmedCache = _parsed.confirmed || [];
          dashboardRejectedCache  = _parsed.rejected  || [];
          loadingEl.classList.add('hidden');
          hydrateDashboardFromCache();
          return;
        }
      }
    } catch(e) {}

    loadingEl.classList.remove('hidden');
    loadDashboardWithRetry(0);
  }

  function loadDashboardWithRetry(attempt) {
    var MAX_RETRY = 2;
    var loadingEl = document.getElementById('dashboardLoading');
    var errorEl   = document.getElementById('dashboardError');

    if (loadingEl) { loadingEl.style.display = 'flex'; }
    if (errorEl)   errorEl.classList.add('hidden');

    gasGet_('getDashboardDataOptimized')
      .then(function(response) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (!response) {
          if (attempt < MAX_RETRY) {
            setTimeout(function() { loadDashboardWithRetry(attempt + 1); }, 1200);
            return;
          }
          if (errorEl) errorEl.classList.remove('hidden');
          return;
        }
        if (response._debug) console.warn('[Dashboard] GAS debug:', response._debug);
        if (response.error) console.error('[Dashboard] GAS error:', response.error);
        dashboardCache = response;
        dashboardPendingCache   = response.pending   || [];
        dashboardConfirmedCache = response.confirmed || [];
        dashboardRejectedCache  = response.rejected  || [];
        // Save to sessionStorage with timestamp
        try { response._ts = Date.now(); sessionStorage.setItem('dashCache', JSON.stringify(response)); } catch(e) {}
        hydrateDashboardFromCache();
      })
      .catch(function() {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (attempt < MAX_RETRY) {
          setTimeout(function() { loadDashboardWithRetry(attempt + 1); }, 1200);
          return;
        }
        if (errorEl) errorEl.classList.remove('hidden');
      });
  }

  function openLoginRequiredModal(customText) {
    const modal = document.getElementById('loginRequiredModal');
    const card = document.getElementById('loginRequiredCard');
    const btn = document.getElementById('loginRequiredBtn');
    const textEl = document.getElementById('loginRequiredText');

    if (!modal || !card) return;

    if (textEl) textEl.innerText = customText || 'Silakan login untuk mengakses History.';

    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      card.classList.remove('opacity-0', 'scale-95');
      card.classList.add('opacity-100', 'scale-100');
    });

    btn.onclick = function () {
      closeLoginRequiredModal();
      openPageSaya();
    };
  }

  function closeLoginRequiredModal() {
    const modal = document.getElementById('loginRequiredModal');
    const card = document.getElementById('loginRequiredCard');

    if (!modal || !card) return;

    card.classList.remove('opacity-100', 'scale-100');
    card.classList.add('opacity-0', 'scale-95');

    setTimeout(() => {
      modal.classList.add('hidden');
    }, 180);
  }

  function refreshDashboard() {
    const dashboardEl = document.getElementById('dashboard');
    const loadingEl = document.getElementById('dashboardLoading');
    const errorEl = document.getElementById('dashboardError');
    const listEl = document.getElementById('dashboardList');

    // 🔥 RESET FRONTEND CACHE
    dashboardCache = null;
    dashboardPendingCache = [];
    dashboardConfirmedCache = [];
    dashboardRejectedCache = [];
    try { sessionStorage.removeItem('dashCache'); } catch(e) {}

    // 🔥 CLEAR UI DULU (BIAR TIDAK TERLIHAT STALE)
    if (listEl) listEl.innerHTML = '';
    if (errorEl) errorEl.classList.add('hidden');
    if (loadingEl) { loadingEl.style.display = 'flex'; }

    // 🔥 CALL FRESH DATA (SERVER CLEAR CACHE)
    gasGet_('getDashboardDataFresh')
      .then(function(response) {
        if (!response) {
          loadingEl.classList.add('hidden');
          errorEl.classList.remove('hidden');
          return;
        }
        dashboardCache = response;
        dashboardPendingCache = response.pending || [];
        dashboardConfirmedCache = response.confirmed || [];
        loadingEl.classList.add('hidden');
        hydrateDashboardFromCache();
        showToast('Data berhasil diperbarui','success');
      })
      .catch(function(err) {
        console.error(err);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        showToast('Gagal memuat data terbaru','error');
      });
  }

  function updateDashboardTimestamp() {
    const el = document.getElementById('dashboardLastUpdated');
    if (!el) return;

    const now = new Date();

    const time = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    el.style.opacity = '0';

    setTimeout(() => {
      el.innerText = `Updated ${time}`;
      el.style.opacity = '1';
    }, 120);
  }

  function hydrateDashboardFromCache() {
    const loadingEl = document.getElementById('dashboardLoading');
    if (loadingEl) {
      loadingEl.classList.add('hidden');
    }
    // pastikan tab aktif konsisten
    activeTabType = activeTabType || 'pending';
    // set underline active UI saja
    document.querySelectorAll('.tab-underline')
      .forEach(btn => btn.classList.remove('active'));
    if (activeTabType === 'pending') {
      document.getElementById('tabPending')?.classList.add('active');
    } else {
      document.getElementById('tabConfirmed')?.classList.add('active');
    }
    // 🔥 WAJIB: hitung ulang count + render sesuai filter & role
    applyFilters();
    updateDashboardTimestamp();
    updateDashboardScorecards();
  }

  function updateDashboardScorecards() {
    var isAdmin = currentUser && currentUser.role === 'admin';
    var sc = document.getElementById('dashboardScorecards');
    if (!sc) return;
    sc.classList.remove('hidden');

    var el = function(id) { return document.getElementById(id); };
    // Compact format: 1.200.000 → 1,2 Jt, 43.825.000 → 43,8 Jt
    function fmt(n) {
      n = Number(n);
      if (n >= 1000000) return 'Rp ' + (n / 1000000).toFixed(1).replace('.', ',') + ' Jt';
      if (n >= 1000)    return 'Rp ' + Math.round(n / 1000) + ' Rb';
      return 'Rp ' + n.toLocaleString('id-ID');
    }

    if (isAdmin) {
      var pending   = dashboardPendingCache   || [];
      var confirmed = dashboardConfirmedCache || [];
      var pendingAmt   = pending.reduce(function(s, i)   { return s + Number(i.nominal || 0); }, 0);
      var confirmedAmt = confirmed.reduce(function(s, i) { return s + Number(i.nominal || 0); }, 0);

      if (el('scPendingLabel'))    el('scPendingLabel').textContent   = 'Pending';
      if (el('scPendingCount'))    el('scPendingCount').textContent   = pending.length;
      if (el('scPendingAmount'))   el('scPendingAmount').textContent  = fmt(pendingAmt);
      if (el('scConfirmedLabel'))  el('scConfirmedLabel').textContent = 'Dikonfirmasi';
      if (el('scConfirmedCount'))  el('scConfirmedCount').textContent = confirmed.length;
      if (el('scConfirmedAmount')) el('scConfirmedAmount').textContent = fmt(confirmedAmt);
      if (el('scTotalAmount'))     el('scTotalAmount').textContent    = fmt(confirmedAmt);
      if (el('scTotalLabel'))      el('scTotalLabel').textContent     = 'terkumpul';
    } else {
      // Warga: filter by their own email only
      var myEmail = currentUser && currentUser.email ? currentUser.email.trim().toLowerCase() : '';
      var wargaPending   = (dashboardPendingCache   || []).filter(function(i) { return (i.email || '').toLowerCase() === myEmail; });
      var wargaConfirmed = (dashboardConfirmedCache || []).filter(function(i) { return (i.email || '').toLowerCase() === myEmail; });
      var wargaPendingAmt   = wargaPending.reduce(function(s, i)   { return s + Number(i.nominal || 0); }, 0);
      var wargaConfirmedAmt = wargaConfirmed.reduce(function(s, i) { return s + Number(i.nominal || 0); }, 0);
      var wargaTotalAmt = wargaPendingAmt + wargaConfirmedAmt;

      if (el('scPendingLabel'))    el('scPendingLabel').textContent   = 'Menunggu';
      if (el('scPendingCount'))    el('scPendingCount').textContent   = wargaPending.length;
      if (el('scPendingAmount'))   el('scPendingAmount').textContent  = fmt(wargaPendingAmt);
      if (el('scConfirmedLabel'))  el('scConfirmedLabel').textContent = 'Lunas';
      if (el('scConfirmedCount'))  el('scConfirmedCount').textContent = wargaConfirmed.length;
      if (el('scConfirmedAmount')) el('scConfirmedAmount').textContent = fmt(wargaConfirmedAmt);
      if (el('scTotalAmount'))     el('scTotalAmount').textContent    = fmt(wargaTotalAmt);
      if (el('scTotalLabel'))      el('scTotalLabel').textContent     = 'total submit';

      // Make scorecard cards clickable as filters
      _bindWargaScorecard_();
    }
  }

  var _wargaScorecardBound_ = false;
  function _bindWargaScorecard_() {
    if (_wargaScorecardBound_) return;
    _wargaScorecardBound_ = true;
    var sc = document.getElementById('dashboardScorecards');
    if (!sc) return;
    var cards = sc.querySelectorAll('.flex-1');
    // cards[0]=pending, cards[1]=confirmed, cards[2]=total
    var types = ['pending', 'confirmed', 'all'];
    cards.forEach(function(card, idx) {
      card.style.cursor = 'pointer';
      card.style.transition = 'opacity 0.15s, transform 0.15s';
      card.addEventListener('click', function() {
        if (navigator.vibrate) navigator.vibrate(20);
        wargaScoreFilter = types[idx];
        // Visual: highlight active card
        cards.forEach(function(c, i) {
          c.style.opacity = (i === idx) ? '1' : '0.5';
          c.style.transform = (i === idx) ? 'scale(1.03)' : 'scale(1)';
        });
        applyFilters();
      });
    });
  }

  function closeDashboard() {
    switchPage('homePage');
    if (activePolling) {
      clearInterval(activePolling);
      activePolling = null;
    }
    setActiveNavById('navHome');
  }

  // ================= COMING SOON MODAL =================
  function openComingSoon() {
    const modal = document.getElementById('comingSoon');
    const card = document.getElementById('comingSoonCard');

    if (!modal || !card) return;

    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
      card.classList.remove('opacity-0', 'scale-95');
      card.classList.add('opacity-100', 'scale-100');
    });
  }

  function closeComingSoon() {
    const modal = document.getElementById('comingSoon');
    const card = document.getElementById('comingSoonCard');

    if (!modal || !card) return;

    card.classList.remove('opacity-100', 'scale-100');
    card.classList.add('opacity-0', 'scale-95');

    setTimeout(() => {
      modal.classList.add('hidden');
    }, 180);
  }

  function setActiveNavById(navId) {
    // Old bottom nav
    const navItems = document.querySelectorAll('.nav-app');
    navItems.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(navId);
    if (activeBtn) activeBtn.classList.add('active');
    // New desktop sidebar
    document.querySelectorAll('.dsk-nav').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelectorAll('.dsk-nav[data-navid="' + navId + '"]').forEach(btn => {
      if (!btn.classList.contains('dsk-nav-cta') && !btn.classList.contains('dsk-nav-logout')) {
        btn.classList.add('active');
      }
    });
  }

  function _updateDesktopSidebarProfile_() {
    var logoutBtn = document.getElementById('dskNavLogout');
    if (!currentUser) {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      // Clear + hide desktop topbar profile
      var tp = document.getElementById('desktopTopbarProfile');
      if (tp) tp.classList.add('hidden');
      var tav = document.getElementById('desktopTopbarAvatar');
      var tnm = document.getElementById('desktopTopbarName');
      var trl = document.getElementById('desktopTopbarRole');
      if (tav) tav.textContent = '';
      if (tnm) tnm.textContent = '';
      if (trl) trl.textContent = '';
      // Clear sidebar profile
      var profile = document.getElementById('desktopSidebarProfile');
      if (profile) profile.classList.add('hidden');
      // Hide admin nav
      var adminBtn = document.getElementById('dskNavAdmin');
      if (adminBtn) adminBtn.classList.add('hidden');
      return;
    }
    var name = currentUser.fullName || currentUser.name || currentUser.email || '';
    var role = currentUser.role === 'admin' ? 'Administrator' : 'Warga';
    var initial = name.trim().charAt(0).toUpperCase() || '?';
    var colors = ['#E53935','#8E24AA','#1E88E5','#00ACC1','#43A047','#FB8C00','#6D4C41','#546E7A','#D81B60','#3949AB'];
    var color = colors[(name.charCodeAt(0) || 0) % colors.length];

    // Sidebar profile
    var profile = document.getElementById('desktopSidebarProfile');
    if (profile) {
      profile.classList.remove('hidden');
      var av = document.getElementById('desktopSidebarAvatar');
      var nm = document.getElementById('desktopSidebarName');
      var rl = document.getElementById('desktopSidebarRole');
      if (av) { av.textContent = initial; av.style.background = color; }
      if (nm) nm.textContent = name;
      if (rl) rl.textContent = role;
    }

    // Topbar profile (right) — show when logged in
    var tp  = document.getElementById('desktopTopbarProfile');
    if (tp)  { tp.classList.remove('hidden'); tp.classList.add('flex'); }
    var tav = document.getElementById('desktopTopbarAvatar');
    var tnm = document.getElementById('desktopTopbarName');
    var trl = document.getElementById('desktopTopbarRole');
    if (tav) { tav.textContent = initial; tav.style.background = color; }
    if (tnm) tnm.textContent = name;
    if (trl) trl.textContent = role;

    // Topbar greeting (left) — sync from home page greeting els
    var greetSrc = document.getElementById('homeGreeting');
    var userSrc  = document.getElementById('homeUsername');
    var tg = document.getElementById('desktopTopbarGreeting');
    if (tg && greetSrc) tg.innerHTML = greetSrc.innerHTML;

    // Admin button
    var adminBtn = document.getElementById('dskNavAdmin');
    if (adminBtn) {
      if (currentUser.role === 'admin') adminBtn.classList.remove('hidden');
      else adminBtn.classList.add('hidden');
    }

    // Logout button — show only when logged in
    var logoutBtn = document.getElementById('dskNavLogout');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  }

  function openLoginModal() {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('loginStepEmail').classList.remove('hidden');
    document.getElementById('loginStepOTP').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('otpError').classList.add('hidden');
  }

  function requestOTP() {
    const email = document.getElementById('loginEmailInput').value.trim();
    const errorEl = document.getElementById('loginError');

    if (!email) {
      errorEl.innerText = 'Email wajib diisi';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = document.querySelector('#loginStepEmail button');
    btn.disabled = true;

    // Stage 1
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="white" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="white" stroke-width="3"
            fill="none"/>
        </svg>
        Memeriksa email...
      </span>
    `;

    // Delay kecil agar terasa proses validasi
    setTimeout(() => {
      btn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="white" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="white" stroke-width="3"
              fill="none"/>
          </svg>
          Mengirim OTP...
        </span>
      `;
    }, 600);

    gasPost_('requestLoginOTP', { email: email })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Kirim OTP';
        if (!res.success) {
          errorEl.innerText = res.message;
          errorEl.classList.remove('hidden');
          return;
        }
        document.getElementById('loginStepEmail').classList.add('hidden');
        document.getElementById('loginStepOTP').classList.remove('hidden');
      })
      .catch(function() {
        errorEl.innerText = 'Gagal mengirim OTP';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = 'Kirim OTP';
      });
  }

  /* ======================================
    LOGIN VIA PAGE SAYA
  ====================================== */
  function requestOTPSaya() {

    const email = document
      .getElementById('sayaEmailInput')
      ?.value.trim();

    const errorEl =
      document.getElementById('sayaEmailError');

    const btn = document.getElementById('requestOTPBtn');
    // reset error
    errorEl.classList.add('hidden');

    if (!email) {
      var errSpan = errorEl.querySelector('span');
      if (errSpan) errSpan.innerText = 'Email wajib diisi';
      errorEl.classList.remove('hidden');
      var inputEl = document.getElementById('sayaEmailInput');
      triggerInputError(inputEl);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Memeriksa...</span>';

    gasGet_('checkEmail', { email: email })
      .then(function(pinRes) {
        if (!pinRes || !pinRes.success) {
          btn.disabled = false;
          btn.innerHTML = 'Masuk';
          var errSpan = errorEl.querySelector('span');
          if (errSpan) errSpan.innerText = pinRes && pinRes.message ? pinRes.message : 'Email tidak ditemukan di sistem';
          errorEl.classList.remove('hidden');
          var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
          if (emailCard) shakeField(emailCard);
          if (navigator.vibrate) navigator.vibrate(40);
          return;
        }
        btn.disabled = false;
        btn.innerHTML = 'Masuk';
        if (pinRes.hasPIN) {
          showLoginMethodStep_(email);
        } else {
          proceedSendOTP_(email);
        }
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Masuk';
        var errSpan = errorEl.querySelector('span');
        if (errSpan) errSpan.innerText = 'Gagal memeriksa akun';
        errorEl.classList.remove('hidden');
        var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
        if (emailCard) shakeField(emailCard);
        if (navigator.vibrate) navigator.vibrate(40);
      });
  }

  function proceedSendOTP_(email) {
    _sayaOTPMode_ = 'first_otp';
    var btn = document.getElementById('requestOTPBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Mengirim OTP...</span>';

    gasPost_('requestLoginOTP', { email: email })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Kirim Kode OTP';
        if (!res || !res.success) {
          var errorEl = document.getElementById('sayaEmailError');
          if (errorEl) {
            var errSpan = errorEl.querySelector('span');
            if (errSpan) errSpan.innerText = res && res.message ? res.message : 'Gagal mengirim OTP';
            errorEl.classList.remove('hidden');
          }
          return;
        }
        var emailStep = document.getElementById('sayaStepEmail');
        var otpStep   = document.getElementById('sayaStepOTP');
        emailStep.style.opacity = '0';
        emailStep.style.transform = 'translateY(6px)';
        emailStep.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
        setTimeout(function() {
          emailStep.classList.add('hidden');
          emailStep.style.opacity = '';
          emailStep.style.transform = '';
          otpStep.classList.remove('hidden');
          otpStep.style.display = 'flex';
          otpStep.style.flexDirection = 'column';
          otpStep.style.height = '100%';
          otpStep.style.overflowY = 'auto';
          otpStep.classList.add('saya-step');
          setTimeout(function() { otpStep.classList.remove('saya-step'); }, 300);
        }, 180);
        var sentTo = document.getElementById('otpSentTo');
        if (sentTo) sentTo.innerHTML = 'Kode dikirim ke <span class="text-primary font-semibold">' + email + '</span>';
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Kirim Kode OTP';
        var errorEl = document.getElementById('sayaEmailError');
        if (errorEl) {
          var errSpan = errorEl.querySelector('span');
          if (errSpan) errSpan.innerText = 'Gagal mengirim OTP, coba lagi';
          errorEl.classList.remove('hidden');
        }
      });
  }

  function showLoginMethodStep_(email) {
    var emailStep = document.getElementById('sayaStepEmail');
    var methodStep = document.getElementById('sayaStepMethod');
    if (!methodStep) return;
    emailStep.classList.add('hidden');
    methodStep.style.display = '';
    methodStep.classList.remove('hidden');
    var methodEmail = document.getElementById('sayaMethodEmail');
    if (methodEmail) methodEmail.innerText = email;
  }

  async function hashPIN_(pin) {
    var msgBuffer = new TextEncoder().encode(pin);
    var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function loginWithPINSaya() {
    var email = document.getElementById('sayaEmailInput')
      ? document.getElementById('sayaEmailInput').value.trim() : '';
    var pinVal = document.getElementById('sayaPINLoginInput')
      ? document.getElementById('sayaPINLoginInput').value.trim() : '';
    var errorEl = document.getElementById('sayaPINLoginError');
    if (!pinVal || pinVal.length !== 6) {
      if (errorEl) { errorEl.innerText = 'PIN harus 6 digit'; errorEl.classList.remove('hidden'); }
      return;
    }
    var btn = document.getElementById('sayaPINLoginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Memverifikasi...</span>';
    hashPIN_(pinVal).then(function(pinHash) {
      return gasPost_('verifyPIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false;
      btn.innerHTML = 'Masuk dengan PIN';
      if (!res || !res.success) {
        if (errorEl) { errorEl.innerText = res && res.message ? res.message : 'PIN salah'; errorEl.classList.remove('hidden'); }
        if (navigator.vibrate) navigator.vibrate(40);
        return;
      }
      // Login berhasil — same flow as verifyOTPSaya
      currentUser = res.user;
      saveSession(res.user);
      updateHeaderAuthUI();
      initNotifications();
      var otpStepEl = document.getElementById('sayaStepMethod');
      if (otpStepEl) { otpStepEl.classList.add('hidden'); otpStepEl.style.display = ''; otpStepEl.style.height = ''; }
      var emailStepEl = document.getElementById('sayaStepEmail');
      if (emailStepEl) { emailStepEl.classList.add('hidden'); emailStepEl.style.display = ''; emailStepEl.style.height = ''; }
      document.getElementById('sayaProfileName').innerText = res.user.fullName || 'User';
      document.getElementById('sayaProfileEmail').innerText = res.user.email;
      _renderProfileAvatar_(res.user.fullName || 'User');
      var loggedInView = document.getElementById('sayaLoggedInView');
      if (loggedInView) {
        loggedInView.classList.remove('hidden');
        loggedInView.style.display = 'flex';
        loggedInView.style.flexDirection = 'column';
        loggedInView.style.flex = '1';
        loggedInView.style.minHeight = '0';
      }
      document.body.classList.remove('saya-open');
      switchPage('homePage');
      setActiveNavById('navHome');
      loadHomeData();
      gasGet_('getCurrentUserDataWarga', { email: res.user.email }).then(function(wRes) {
        if (!currentUser) return;
        if (!wRes || !wRes.success) return;
        currentUser.wargaData = wRes.data || [];
        saveSession(currentUser);
        var listEl  = document.getElementById('sayaBlokList');
        var namaEl  = document.getElementById('sayaNamaInput');
        var hpEl    = document.getElementById('sayaHpInput');
        var emailEl = document.getElementById('sayaEmailEditInput');
        if (listEl) {
          listEl.innerHTML = '';
          var blokStr = wRes.data.map(function(d) { return d.blok || ''; }).filter(Boolean).join(', ');
          var div = document.createElement('div');
          div.innerText = blokStr || '—';
          listEl.appendChild(div);
        }
        if (namaEl)  namaEl.value  = wRes.data[0].nama  || '';
        if (hpEl)    hpEl.value    = wRes.data[0].noHp  || '';
        if (emailEl) emailEl.value = wRes.data[0].email || '';
        setTimeout(function() { showToast('Anda telah login', 'success'); }, 300);
      });
    }).catch(function() {
      btn.disabled = false;
      btn.innerHTML = 'Masuk dengan PIN';
      if (errorEl) { errorEl.innerText = 'Verifikasi gagal'; errorEl.classList.remove('hidden'); }
    });
  }

  // 'login' | 'reset_pin' | 'first_otp'
  var _sayaOTPMode_ = 'login';

  function switchToOTPFromPIN_() {
    _sayaOTPMode_ = 'login';
    var methodStep = document.getElementById('sayaStepMethod');
    var emailStep = document.getElementById('sayaStepEmail');
    var email = document.getElementById('sayaEmailInput')
      ? document.getElementById('sayaEmailInput').value.trim() : '';

    // Kirim OTP dulu ke email sebelum switch UI
    var otpBtn = document.getElementById('sayaKirimOTPBtn');
    if (otpBtn) {
      otpBtn.disabled = true;
      otpBtn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/></svg>Mengirim...</span>';
    }

    gasPost_('requestLoginOTP', { email: email })
      .then(function() {
        if (otpBtn) { otpBtn.disabled = false; otpBtn.innerHTML = 'Kirim OTP ke Email'; }
        if (methodStep) { methodStep.classList.add('hidden'); methodStep.style.display = ''; methodStep.style.height = ''; }
        if (emailStep) { emailStep.classList.add('hidden'); emailStep.style.display = ''; emailStep.style.height = ''; }
        var otpStep = document.getElementById('sayaStepOTP');
        if (otpStep) {
          otpStep.classList.remove('hidden');
          otpStep.style.display = 'flex';
          otpStep.style.flexDirection = 'column';
          otpStep.style.height = '100%';
          otpStep.style.overflowY = 'auto';
        }
        var sentTo = document.getElementById('otpSentTo');
        if (sentTo) sentTo.innerHTML = 'Kode dikirim ke <span class="text-primary font-semibold">' + email + '</span>';
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        if (otpBtn) { otpBtn.disabled = false; otpBtn.innerHTML = 'Kirim OTP ke Email'; }
        showToast('Gagal mengirim OTP, coba lagi', 'error');
      });
  }

  function openCreatePINModal() {
    var modal = document.getElementById('createPINModal');
    if (!modal) return;
    document.getElementById('createPINInput').value = '';
    document.getElementById('createPINConfirm').value = '';
    document.getElementById('createPINError').classList.add('hidden');
    modal.classList.remove('hidden');
  }

  function closeCreatePINModal() {
    var modal = document.getElementById('createPINModal');
    if (modal) modal.classList.add('hidden');
  }

  function submitCreatePIN() {
    var pin1 = document.getElementById('createPINInput').value.trim();
    var pin2 = document.getElementById('createPINConfirm').value.trim();
    var errorEl = document.getElementById('createPINError');
    errorEl.classList.add('hidden');
    if (pin1.length !== 6 || !/^\d{6}$/.test(pin1)) {
      errorEl.innerText = 'PIN harus 6 digit angka'; errorEl.classList.remove('hidden'); return;
    }
    if (pin1 !== pin2) {
      errorEl.innerText = 'Konfirmasi PIN tidak cocok'; errorEl.classList.remove('hidden'); return;
    }
    var btn = document.getElementById('createPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false;
      btn.innerText = 'Simpan PIN';
      if (!res || !res.success) {
        errorEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN';
        errorEl.classList.remove('hidden'); return;
      }
      closeCreatePINModal();
      showToast('PIN berhasil disimpan 🔐', 'success');
    }).catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan PIN';
      errorEl.innerText = 'Gagal menyimpan PIN'; errorEl.classList.remove('hidden');
    });
  }

  function verifyOTPSaya() {
    var email = document.getElementById('sayaEmailInput')
                  ? document.getElementById('sayaEmailInput').value.trim()
                  : '';

    var otp = document.getElementById('sayaOTPInput')
                ? document.getElementById('sayaOTPInput').value.trim()
                : '';

    var errorEl = document.getElementById('sayaOTPError');

    if (!otp || otp.length !== 6) {
      errorEl.innerText = 'OTP harus 6 digit';
      errorEl.classList.remove('hidden');
      return;
    }

    var btn = document.getElementById('verifyOTPBtn');

    btn.disabled = true;
    btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px">'
      + '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">'
      + '<circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/>'
      + '<path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/>'
      + '</svg>Memverifikasi...</span>';

    gasPost_('verifyLoginOTP', { email: email, otp: otp })
      .then(function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        if (!res.success) {
          errorEl.innerText = res.message || 'OTP tidak valid';
          errorEl.classList.remove('hidden');
          return;
        }
        currentUser = res.user;
        saveSession(res.user);
        updateHeaderAuthUI();
        initNotifications();
        _afterOTPVerified_(res.user);
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        errorEl.innerText = 'Verifikasi gagal';
        errorEl.classList.remove('hidden');
      });
  }

  /* ===== OTP MODE: SWITCH TO RESET PIN ===== */
  function switchToResetPINViaOTP_() {
    _sayaOTPMode_ = 'reset_pin';
    var methodStep = document.getElementById('sayaStepMethod');
    var emailStep  = document.getElementById('sayaStepEmail');
    var email = document.getElementById('sayaEmailInput')
      ? document.getElementById('sayaEmailInput').value.trim() : '';
    var btn = document.getElementById('sayaLupaPINBtn');
    if (btn) { btn.disabled = true; btn.innerText = 'Mengirim OTP...'; }
    gasPost_('requestLoginOTP', { email: email })
      .then(function() {
        if (btn) { btn.disabled = false; btn.innerText = 'Lupa PIN? Reset via OTP'; }
        if (methodStep) { methodStep.classList.add('hidden'); methodStep.style.display = ''; methodStep.style.height = ''; }
        if (emailStep) { emailStep.classList.add('hidden'); emailStep.style.display = ''; emailStep.style.height = ''; }
        var otpStep = document.getElementById('sayaStepOTP');
        if (otpStep) { otpStep.classList.remove('hidden'); otpStep.style.display = 'flex'; otpStep.style.flexDirection = 'column'; otpStep.style.height = '100%'; otpStep.style.overflowY = 'auto'; }
        var sentTo = document.getElementById('otpSentTo');
        if (sentTo) sentTo.innerHTML = 'Kode dikirim ke <span class="text-primary font-semibold">' + email + '</span>';
        initOTPBoxes();
        startOTPCountdown();
      })
      .catch(function() {
        if (btn) { btn.disabled = false; btn.innerText = 'Lupa PIN? Reset via OTP'; }
        showToast('Gagal mengirim OTP, coba lagi', 'error');
      });
  }

  /* ===== AFTER OTP VERIFIED — BRANCHING ===== */
  function _afterOTPVerified_(user) {
    if (_sayaOTPMode_ === 'reset_pin') {
      showResetPINStep_();
      return;
    }
    if (_sayaOTPMode_ === 'first_otp') {
      showPINOfferModal_();
      return;
    }
    _doLoginFromOTP_(user);
  }

  /* ===== SHARED LOGIN FLOW (after OTP / after PIN saved) ===== */
  function _doLoginFromOTP_(user) {
    ['sayaStepOTP','sayaStepMethod','sayaStepEmail','sayaStepResetPIN'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.style.display = ''; el.style.height = ''; el.style.flexDirection = ''; el.style.overflowY = ''; }
    });
    var profName = document.getElementById('sayaProfileName');
    var profEmail = document.getElementById('sayaProfileEmail');
    if (profName) profName.innerText = user.fullName || 'User';
    if (profEmail) profEmail.innerText = user.email;
    _renderProfileAvatar_(user.fullName || 'User');
    _updateDesktopSidebarProfile_();
    document.getElementById('sayaLoggedInView').classList.remove('hidden');
    document.body.classList.remove('saya-open');
    switchPage('homePage');
    setActiveNavById('navHome');
    loadHomeData();
    var badgeEl = document.getElementById('sayaProfileBlokBadge');
    if (badgeEl && user.blocks && user.blocks.length) badgeEl.innerText = 'Blok ' + user.blocks.join(', ');
    gasGet_('getCurrentUserDataWarga', { email: user.email })
      .then(function(wRes) {
        if (!currentUser) return;
        if (!wRes || !wRes.success) return;
        currentUser.wargaData = wRes.data || [];
        saveSession(currentUser);
        var listEl  = document.getElementById('sayaBlokList');
        var namaEl  = document.getElementById('sayaNamaInput');
        var hpEl    = document.getElementById('sayaHpInput');
        var emailEl = document.getElementById('sayaEmailEditInput');
        if (listEl) {
          listEl.innerHTML = '';
          var blokStr = wRes.data.map(function(d) { return d.blok || ''; }).filter(Boolean).join(', ');
          var div = document.createElement('div');
          div.innerText = blokStr || '—';
          listEl.appendChild(div);
        }
        if (namaEl && wRes.data[0])  namaEl.value  = wRes.data[0].nama  || '';
        if (hpEl   && wRes.data[0])  hpEl.value    = wRes.data[0].noHp  || '';
        if (emailEl && wRes.data[0]) emailEl.value = wRes.data[0].email || '';
        setTimeout(function() { showToast('Anda telah login', 'success'); }, 300);
      });
  }

  /* ===== RESET PIN STEP (wajib, dari "Lupa PIN") ===== */
  function showResetPINStep_() {
    var otpStep = document.getElementById('sayaStepOTP');
    if (otpStep) { otpStep.classList.add('hidden'); otpStep.style.display = ''; otpStep.style.height = ''; otpStep.style.overflowY = ''; }
    var step = document.getElementById('sayaStepResetPIN');
    if (step) { step.classList.remove('hidden'); step.style.display = 'flex'; step.style.height = '100%'; }
    var p1 = document.getElementById('resetPINInput');
    var p2 = document.getElementById('resetPINConfirm');
    var err = document.getElementById('resetPINError');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) { err.innerText = ''; err.classList.add('hidden'); }
  }

  function submitResetPIN_() {
    var pin1 = (document.getElementById('resetPINInput') || {}).value || '';
    var pin2 = (document.getElementById('resetPINConfirm') || {}).value || '';
    var errEl = document.getElementById('resetPINError');
    errEl.classList.add('hidden');
    if (!/^\d{6}$/.test(pin1.trim())) { errEl.innerText = 'PIN harus 6 digit angka'; errEl.classList.remove('hidden'); return; }
    if (pin1 !== pin2) { errEl.innerText = 'Konfirmasi PIN tidak cocok'; errEl.classList.remove('hidden'); return; }
    var btn = document.getElementById('resetPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1.trim()).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false; btn.innerText = 'Simpan PIN Baru';
      if (!res || !res.success) { errEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN'; errEl.classList.remove('hidden'); return; }
      var step = document.getElementById('sayaStepResetPIN');
      if (step) { step.classList.add('hidden'); step.style.display = ''; step.style.height = ''; }
      showToast('PIN baru berhasil dibuat! 🔐', 'success');
      _doLoginFromOTP_(currentUser);
    }).catch(function() {
      btn.disabled = false; btn.innerText = 'Simpan PIN Baru';
      errEl.innerText = 'Gagal menyimpan PIN'; errEl.classList.remove('hidden');
    });
  }

  function skipResetPIN_() {
    var step = document.getElementById('sayaStepResetPIN');
    if (step) { step.classList.add('hidden'); step.style.display = ''; step.style.height = ''; }
    _doLoginFromOTP_(currentUser);
  }

  /* ===== PIN OFFER MODAL (opsional, untuk user tanpa PIN) ===== */
  function showPINOfferModal_() {
    var modal = document.getElementById('sayaPINOfferModal');
    if (!modal) { _doLoginFromOTP_(currentUser); return; }
    var p1 = document.getElementById('offerPINInput');
    var p2 = document.getElementById('offerPINConfirm');
    var err = document.getElementById('offerPINError');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) { err.innerText = ''; err.classList.add('hidden'); }
    modal.classList.remove('hidden');
  }

  function submitPINOffer_() {
    var pin1 = (document.getElementById('offerPINInput') || {}).value || '';
    var pin2 = (document.getElementById('offerPINConfirm') || {}).value || '';
    var errEl = document.getElementById('offerPINError');
    errEl.classList.add('hidden');
    if (!/^\d{6}$/.test(pin1.trim())) { errEl.innerText = 'PIN harus 6 digit angka'; errEl.classList.remove('hidden'); return; }
    if (pin1 !== pin2) { errEl.innerText = 'Konfirmasi PIN tidak cocok'; errEl.classList.remove('hidden'); return; }
    var btn = document.getElementById('offerPINSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;"><svg style="width:16px;height:16px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="3"/></svg>Menyimpan...</span>';
    var email = currentUser ? currentUser.email : '';
    hashPIN_(pin1.trim()).then(function(pinHash) {
      return gasPost_('savePIN', { email: email, pinHash: pinHash });
    }).then(function(res) {
      btn.disabled = false; btn.innerText = 'Buat PIN Sekarang';
      if (!res || !res.success) { errEl.innerText = res && res.message ? res.message : 'Gagal menyimpan PIN'; errEl.classList.remove('hidden'); return; }
      var modal = document.getElementById('sayaPINOfferModal');
      if (modal) modal.classList.add('hidden');
      showToast('PIN berhasil dibuat! 🔐 Login lebih cepat mulai sekarang', 'success');
      _doLoginFromOTP_(currentUser);
    }).catch(function() {
      btn.disabled = false; btn.innerText = 'Buat PIN Sekarang';
      errEl.innerText = 'Gagal menyimpan PIN'; errEl.classList.remove('hidden');
    });
  }

  function skipPINOffer_() {
    var modal = document.getElementById('sayaPINOfferModal');
    if (modal) modal.classList.add('hidden');
    _doLoginFromOTP_(currentUser);
  }

  /* ===== INIT UI EVENTS ===== */
  document.addEventListener('DOMContentLoaded', function () {
    var sayaEmailInput = document.getElementById('sayaEmailInput');
    if (!sayaEmailInput) return;

    // Enter key → submit
    sayaEmailInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') requestOTPSaya();
    });

    // Auto-hide error saat field diketik/dikosongkan
    sayaEmailInput.addEventListener('input', function() {
      var errorEl = document.getElementById('sayaEmailError');
      if (!errorEl) return;
      if (!this.value.trim()) {
        errorEl.classList.add('hidden');
      } else {
        errorEl.classList.add('hidden');
      }
    });
  });

  function initOTPBoxes(){
    const boxes = document.querySelectorAll('.otp-box');
    boxes.forEach((box, index)=>{
      box.addEventListener('input', e => {
        const val = e.target.value.replace(/[^0-9]/g,'');
        box.value = val;
        if(val && boxes[index+1]){
          boxes[index+1].focus();
        }
        collectOTP();
        box.classList.toggle('filled', !!val);
      });

      box.addEventListener('keydown', e => {
        if(e.key === 'Backspace' && !box.value && boxes[index-1]){
          boxes[index-1].focus();
        }
      });

      // HANDLE PASTE
      box.addEventListener('paste', e => {
        const paste = (e.clipboardData || window.clipboardData)
          .getData('text')
          .replace(/[^0-9]/g,'');
        if(!paste) return;
        e.preventDefault();
        paste.split('').forEach((num, i)=>{
          if(boxes[i]){
            boxes[i].value = num;
          }
        });

        collectOTP();
        boxes.forEach(function(b) { b.classList.toggle('filled', !!b.value); });
        if(boxes[paste.length]){
          boxes[paste.length].focus();
        }
      });
    });
  }

  function collectOTP(){
    var boxes = document.querySelectorAll('.otp-box');
    var otp = '';
    boxes.forEach(function(b){
      otp += b.value || '';
    });
    document.getElementById('sayaOTPInput').value = otp;

    // Auto-submit saat 6 digit penuh
    if (otp.length === 6) {
      setTimeout(function() {
        verifyOTPSaya();
      }, 120);
    }
  }

  function startOTPCountdown(){
    let time = 30;
    const label = document.getElementById('otpCountdown');
    const resendBtn = document.getElementById('resendOTPBtn');
    resendBtn.classList.add('cursor-not-allowed','text-gray-400');
    const timer = setInterval(()=>{
      time--;
      label.innerText =
        'Request kode baru dalam 00:' + String(time).padStart(2,'0');
      if(time <= 0){
        clearInterval(timer);
        label.innerText = '';
        resendBtn.classList.remove('cursor-not-allowed','text-gray-400');
        resendBtn.classList.add('text-primary','cursor-pointer');
        resendBtn.onclick = resendOTP;
      }
    },1000);
  }

  function resendOTP(){
    const btn = document.getElementById('resendOTPBtn');
    if(!btn) return;
    btn.classList.add('cursor-not-allowed');
    btn.onclick = null;

    // SPINNER
    btn.innerHTML = `
      <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"
          stroke="currentColor"
          stroke-width="3"
          fill="none"
          opacity="0.3"/>
        <path d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          stroke-width="3"
          fill="none"/>
      </svg>
      Mengirim...
    `;

    const email = document
      .getElementById('sayaEmailInput')
      ?.value.trim();

    gasPost_('requestLoginOTP', { email: email })
      .then(function() {
        btn.innerHTML = '<svg class="w-3 h-3 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>OTP terkirim';
        setTimeout(function() {
          btn.innerHTML = "Kirim ulang";
          startOTPCountdown();
        }, 1000);
      })
      .catch(function() {
        btn.innerHTML = "Kirim ulang";
      });
  }

  function verifyOTP() {
    const email = document.getElementById('loginEmailInput').value.trim();
    const otp = document.getElementById('loginOTPInput').value.trim();
    const errorEl = document.getElementById('otpError');

    if (!otp || otp.length !== 6) {
      errorEl.innerText = 'OTP harus 6 digit';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = document.querySelector('#loginStepOTP button');
    btn.disabled = true;
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="currentColor" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor" stroke-width="3"
            fill="none"/>
        </svg>
        Memverifikasi...
      </span>
    `;

    gasPost_('verifyLoginOTP', { email: email, otp: otp })
      .then(function(res) {
        if (!res.success) {
          errorEl.innerText = res.message;
          errorEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = 'Verifikasi';
          return;
        }
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        currentUser = res.user;
        saveSession(res.user);
        updateHeaderAuthUI();
        initNotifications();
        loadHomeData();
        closeLoginModal();
        openDashboard();
        showToast('Anda telah login','success');
      })
      .catch(function() {
        errorEl.innerText = 'Verifikasi gagal';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
      });
  }

  function logoutUserUI() {
    if (!currentUser) return;
    const email = currentUser.email;
    gasPost_('logoutUser', { email: email })
      .then(function() {
        currentUser = null;
        clearSession();
        dashboardCache = null;
        dashboardPendingCache = [];
        dashboardConfirmedCache = [];
        // Stop greeting typing animation
        _greetingToken_++;
        updateHeaderAuthUI();
        closeDashboard();
        showToast('Anda telah logout','success');
      })
      .catch(function() {
        showToast('Gagal logout','error');
      });
  }
  

  function openLogoutConfirm() {
    var modal = document.getElementById('logoutConfirmModal');
    var card  = document.getElementById('logoutConfirmCard');
    modal.classList.remove('hidden');
    setTimeout(function() {
      card.classList.remove('scale-95', 'opacity-0');
      card.classList.add('scale-100', 'opacity-100');
    }, 10);
  }

  function closeLogoutConfirm() {
    var modal = document.getElementById('logoutConfirmModal');
    var card  = document.getElementById('logoutConfirmCard');
    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(function() {
      modal.classList.add('hidden');
    }, 200);
  }

  function logoutSaya() {
    // Immediate feedback — disable button & show spinner
    var logoutBtn = document.querySelector('#logoutConfirmCard button:last-child');
    if (logoutBtn) {
      logoutBtn.disabled = true;
      logoutBtn.innerHTML = '<svg class="w-4 h-4 animate-spin inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M22 12a10 10 0 0 1-10 10"/></svg> Keluar...';
    }

    const emailToLogout = currentUser ? currentUser.email : null;

    function _doResetUI_() {
      // 1. Reset semua state DULU
      currentUser = null;
      clearSession(); // Hapus session dari localStorage
      wargaPaidMonths    = null;
      wargaPendingMonths = null;
      wargaRateByMonth   = null;
      userOverrideRateByYear = {};
      selectedMonthsByYear = {};
      homeDataCache.tunggakan = null;
      homeDataCache.contact = null;
      homeDataCache.security = null;
      dashboardCache = null;
      dashboardPendingCache = [];
      dashboardConfirmedCache = [];
      try { sessionStorage.removeItem('dashCache'); } catch(e) {}

      // 2. Update auth UI (tarif mask, header)
      updateHeaderAuthUI();

      // 3. Reset logout modal
      var logoutBtnReset = document.querySelector('#logoutConfirmCard button:last-child');
      if (logoutBtnReset) { logoutBtnReset.disabled = false; logoutBtnReset.innerHTML = 'Ya, Keluar'; }
      closeLogoutConfirm();
      document.body.classList.remove('saya-open');

      // 4. Reset step saya
      document.getElementById('sayaLoggedInView').classList.add('hidden');
      document.getElementById('sayaStepEmail').classList.remove('hidden');
      var _smReset = document.getElementById('sayaStepMethod');
      if (_smReset) { _smReset.classList.add('hidden'); _smReset.style.display = ''; _smReset.style.height = ''; }
      document.getElementById('sayaStepOTP').classList.add('hidden');
      document.getElementById('sayaEmailInput').value = '';
      document.getElementById('sayaOTPInput').value = '';
      var pinInput = document.getElementById('sayaPINLoginInput');
      if (pinInput) pinInput.value = '';
      var pinError = document.getElementById('sayaPINLoginError');
      if (pinError) { pinError.innerText = ''; pinError.classList.add('hidden'); }
      var methodEmail = document.getElementById('sayaMethodEmail');
      if (methodEmail) methodEmail.innerText = '';
      // Reset new PIN steps/modal
      var resetStep = document.getElementById('sayaStepResetPIN');
      if (resetStep) { resetStep.classList.add('hidden'); resetStep.style.display = ''; resetStep.style.height = ''; }
      var offerModal = document.getElementById('sayaPINOfferModal');
      if (offerModal) offerModal.classList.add('hidden');
      _sayaOTPMode_ = 'login';
      var otpBoxes = document.querySelectorAll('#sayaStepOTP .otp-box');
      otpBoxes.forEach(function(b) { b.value = ''; b.classList.remove('filled'); });

      // 5. Navigate ke home
      switchPage('homePage');
      setActiveNavById('navHome');

      // 6. Reset greeting
      var nameEl = document.getElementById('homeUsername');
      var greetEl = document.getElementById('homeGreeting');
      if (nameEl) nameEl.innerText = 'Warga JPS2';
      if (greetEl) {
        var hour = new Date().getHours();
        var _g = _getGreetingHTML_(hour);
        var _greetHTML = _g.svg + _g.text;
        greetEl.innerHTML = _greetHTML;
        var tgEl = document.getElementById('desktopTopbarGreeting');
        if (tgEl) tgEl.innerHTML = _greetHTML;
      }

      // 7. Reset tunggakan card (currentUser sudah null, loadHomeTunggakan akan mask)
      loadHomeTunggakan();
      loadHomeFasum();
      loadHomeInfo();
      _updatePedomanHint_();

      // 8. Toast — delay agar switchPage selesai render dulu
      setTimeout(function() {
        showToast('Anda telah keluar', 'success');
      }, 150);
    }

    if (emailToLogout) {
      gasPost_('logoutUser', { email: emailToLogout })
        .then(function() { _doResetUI_(); })
        .catch(function() { _doResetUI_(); });
    } else {
      _doResetUI_();
    }
  }

  function openHome() {
    var homePage = document.getElementById('homePage');
    var alreadyActive = homePage && homePage.classList.contains('active');

    switchPage('homePage');
    history.pushState({ home: true }, '');
    setActiveNavById('navHome');
    loadHomeDataIfNeeded();

    // Jika sudah di home → scroll to top
    if (homePage) homePage.scrollTop = 0;
  }

  function cancelSayaEdit() {
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var editBtn = document.getElementById('sayaEditBtn');
    var saveBtn = document.getElementById('sayaSaveBtn');
    var cancelBtn = document.getElementById('sayaCancelBtn');
    // Restore original values from data attributes
    if (namaEl) { namaEl.value = namaEl.dataset.original || namaEl.value; namaEl.readOnly = true; namaEl.style.borderBottom = ''; namaEl.style.paddingBottom = ''; }
    if (hpEl)   { hpEl.value  = hpEl.dataset.original  || hpEl.value;   hpEl.readOnly  = true; hpEl.style.borderBottom  = ''; hpEl.style.paddingBottom  = ''; }
    if (editBtn)   editBtn.classList.remove('hidden');
    if (saveBtn)   saveBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  function enableSayaEdit() {
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var editBtn = document.getElementById('sayaEditBtn');
    var saveBtn = document.getElementById('sayaSaveBtn');
    var cancelBtn = document.getElementById('sayaCancelBtn');

    // Save originals for cancel
    if (namaEl) namaEl.dataset.original = namaEl.value;
    if (hpEl)   hpEl.dataset.original   = hpEl.value;

    // Hanya nama dan HP yang editable
    [namaEl, hpEl].forEach(function(el) {
      if (!el) return;
      el.readOnly = false;
      el.classList.remove('text-gray-900');
      el.classList.add('text-gray-900');
      // Visual: tambah underline border bawah sebagai edit indicator
      el.style.borderBottom = '1.5px solid #43A047';
      el.style.paddingBottom = '2px';
    });

    if (editBtn)   editBtn.classList.add('hidden');
    if (saveBtn)   saveBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    // Focus ke nama dulu
    if (namaEl) setTimeout(function(){ namaEl.focus(); namaEl.select(); }, 100);
  }

  function saveSayaData() {
    const namaEl  = document.getElementById('sayaNamaInput');
    const hpEl    = document.getElementById('sayaHpInput');
    const emailEl = document.getElementById('sayaEmailEditInput');
    const btn     = document.getElementById('sayaSaveBtn');

    const payload = {
      email: currentUser ? currentUser.email : '',
      nama: namaEl ? namaEl.value.trim() : '',
      noHp: hpEl ? hpEl.value.trim() : ''
    };

    // ===== LOADING STATE =====
    btn.disabled = true;
    btn.innerHTML = `
      <span class="flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"
            stroke="white" stroke-width="3"
            fill="none" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"
            stroke="white" stroke-width="3"
            fill="none"/>
        </svg>
        Menyimpan...
      </span>
    `;

    gasPost_('updateDataWargaFromSaya', { payload: payload })
      .then(function(res) {
        if (!res.success) {
          btn.disabled = false;
          btn.innerHTML = 'Simpan Perubahan';
          showToast('Gagal menyimpan data','error');
          return;
        }
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Berhasil</span>';
        setTimeout(function() {
          [namaEl, hpEl].forEach(function(el) {
            if (!el) return;
            el.readOnly = true;
            el.style.borderBottom = '';
            el.style.paddingBottom = '';
          });
          document.getElementById('sayaEditBtn')?.classList.remove('hidden');
          document.getElementById('sayaSaveBtn')?.classList.add('hidden');
          document.getElementById('sayaCancelBtn')?.classList.add('hidden');
          btn.disabled = false;
          btn.innerHTML = 'Simpan';
          showToast('Data berhasil diperbarui','success');
        }, 800);
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Simpan';
        showToast('Gagal menyimpan data','error');
      });
  }

  function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
  }

  function formatTanggalIndonesia(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);

    if (isNaN(date)) return '';

    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    };

    return date.toLocaleDateString('id-ID', options);
  }

  function renderList(list) {
    const loadingEl = document.getElementById('dashboardLoading');
    if (loadingEl) {
      loadingEl.classList.add('hidden');
      loadingEl.style.display = 'none';
    }

    const container = document.getElementById('dashboardList');
    container.innerHTML = '';

    if (!list.length) {
      container.innerHTML = `
        <div class="text-center text-gray-400 text-sm py-8">
          Tidak ada data pada tab ini.
        </div>
      `;
      return;
    }

    // Group by bulan+tahun
    list.forEach(function(item) {
        var isPending = (item.status || '').toLowerCase() === 'pending';

        // Hitung umur submission untuk follow-up button
        var showFollowUp = false;
        if (isPending && item.timestamp) {
          var ageMs = Date.now() - new Date(item.timestamp).getTime();
          var ageDays = ageMs / (1000 * 60 * 60 * 24);
          showFollowUp = ageDays >= 3;
        }

        var isAdmin = currentUser && currentUser.role === 'admin';
        var confirmedLabel = isAdmin ? 'Confirmed' : 'Lunas';

        var isRejected = (item.status || '').toLowerCase() === 'rejected';

        var statusBadge = isPending
          ? '<span class="px-2 py-0.5 text-[11px] rounded-full bg-yellow-100 text-yellow-700 font-semibold">Pending</span>'
          : isRejected
            ? '<span class="px-2 py-0.5 text-[11px] rounded-full bg-red-50 text-red-500 ring-1 ring-red-200 font-semibold">Ditolak</span>'
            : '<span class="px-2 py-0.5 text-[11px] rounded-full bg-green-50 text-green-600 ring-1 ring-green-200 font-semibold">' + confirmedLabel + '</span>';

        var nominalFmt = 'Rp ' + Number(item.nominal || 0).toLocaleString('id-ID');
        var tanggalFmt = item.tanggal ? formatTanggalIndonesia(item.tanggal) : '';

        var buktiBtn = '<button data-bukti="' + (item.bukti || '') + '"' +
          ' class="lihat-bukti-btn flex items-center gap-1.5 text-xs font-medium text-gray-500 px-3 py-1.5 rounded-xl bg-gray-100 active:scale-95 transition' +
          (!item.bukti ? ' opacity-40 cursor-not-allowed' : '') + '"' +
          (!item.bukti ? ' disabled' : '') + '>' +
          '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/>' +
          '<path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>' +
          '</svg>Bukti</button>';

        var isWarga = currentUser && currentUser.role !== 'admin';
        var reminderBtn = (showFollowUp && isWarga)
          ? '<button onclick="sendReminderToAdmin(' + item.rowNumber + ', this)"' +
            ' class="flex items-center gap-1.5 text-xs font-semibold text-orange-600 px-3 py-1.5 rounded-xl bg-orange-50 active:scale-95 transition">' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
            '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
            '</svg>Ingatkan Pengurus</button>'
          : '';

        var adminConfirmBtn = '';
        var adminWaBtn = '';
        var adminRejectBtn = '';

        if (isPending && currentUser && currentUser.role === 'admin') {
          adminConfirmBtn =
            '<button onclick="confirmPaymentFromUI(' + item.rowNumber + ')"' +
            ' class="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-xl bg-primary active:scale-95 transition">Confirm</button>';

          adminRejectBtn =
            '<button onclick="rejectPaymentFromUI(' + item.rowNumber + ')"' +
            ' class="flex items-center gap-1.5 text-xs font-semibold text-red-600 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 active:scale-95 transition">Reject</button>';

          var noHp = String(item.noHp || '').replace(/\D/g, '');
          if (noHp.startsWith('0')) noHp = '62' + noHp.slice(1);

          if (noHp) {
            var adminName = (currentUser && currentUser.fullName) ? currentUser.fullName : 'Admin';
            var wargaNama = item.nama || 'Warga';
            var periode   = (item.bulan || '') + ' ' + (item.tahun || '');
            var nominalFmtWa = 'Rp ' + Number(item.nominal || 0).toLocaleString('id-ID');

            var waMsg = 'Halo ' + wargaNama + ',\n\n' +
              'Saya *' + adminName + '* dari Pengurus Paguyuban Jade Park Serpong 2.\n\n' +
              'Kami menerima konfirmasi pembayaran IPL Anda:\n' +
              '- Periode: *' + periode + '*\n' +
              '- Nominal: *' + nominalFmtWa + '*\n\n' +
              'Mohon konfirmasi apakah data di atas sudah sesuai ya';

            var waUrl = 'https://wa.me/' + noHp + '?text=' + encodeURIComponent(waMsg);

            adminWaBtn =
              '<a href="' + waUrl + '" target="_blank"' +
              ' class="flex items-center gap-1.5 text-xs font-semibold text-green-700 px-3 py-1.5 rounded-xl bg-green-50 border border-green-200 active:scale-95 transition">' +
              '<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
              '</svg>WA</a>';
          }
        }

        var isConfirmed = (item.status || '').toLowerCase() === 'confirmed';
        var verifiedBySection = '';
        if (isConfirmed && !isAdmin && item.verifiedBy) {
          // tidak tampil di sisi warga
        } else if (isConfirmed && isAdmin && item.verifiedBy) {
          verifiedBySection =
            '<div class="mt-1 flex items-center gap-1">' +
              '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '<span class="text-[10px] text-gray-400">Confirmed by <span class="font-medium text-gray-500">' + (item.verifiedBy ? item.verifiedBy.split('@')[0] : '') + '</span></span>' +
            '</div>';
        }

        var uidSection = !isPending
          ? '<div id="uid-container-' + item.rowNumber + '" class="mt-1">' +
            renderUidTableCompact(item) +
            '</div>'
          : '';

        var card = document.createElement('div');
        card.className = 'bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-gray-100 animate-fadeIn';

        card.innerHTML =
          // ROW 1: Blok + Nama + Status + Nominal
          '<div class="flex items-start justify-between gap-2">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-1.5">' +
                '<span class="text-sm font-bold text-gray-900">' + 
                [item.blok, item.blok2].filter(Boolean).join(', ') + 
              '</span>' +
                '<span class="text-gray-200">·</span>' +
                '<span class="text-xs text-gray-500 truncate">' + (item.nama || '') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="flex flex-col items-end gap-1 flex-shrink-0">' +
              statusBadge +
            '</div>' +
          '</div>' +

          // ROW 2: Periode
          '<div class="mt-1.5 flex items-center gap-1.5">' +
            '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
            '<span class="text-[11px] text-gray-500">' + (item.bulan || '') + ' ' + (item.tahun || '') + '</span>' +
          '</div>' +

          // ROW 3: Tanggal bayar
          (tanggalFmt ?
          '<div class="mt-0.5 flex items-center gap-1.5">' +
            '<svg class="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
            '<span class="text-[11px] text-gray-400">Dibayarkan pada ' + tanggalFmt + '</span>' +
          '</div>' : '') +

          // ROW 4: Nominal
          '<div class="mt-2 flex items-center justify-between">' +
            '<span class="text-xs text-gray-400">Total</span>' +
            '<span class="text-sm font-bold text-gray-900">' + nominalFmt + '</span>' +
          '</div>' +

          // ROW 5: Keterangan warga
          (item.keterangan ?
          '<div class="mt-1.5 flex items-start gap-1.5 bg-amber-50 rounded-xl px-2.5 py-1.5">' +
            '<svg class="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<span class="text-[11px] text-amber-700 italic">' + item.keterangan + '</span>' +
          '</div>' : '') +

          // ROW 6: Alasan reject (hanya jika rejected)
          (isRejected && item.rejectNote ?
          '<div class="mt-1.5 flex items-start gap-1.5 bg-red-50 rounded-xl px-2.5 py-1.5">' +
            '<svg class="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
            '<span class="text-[11px] text-red-600 font-medium">Alasan: ' + item.rejectNote + '</span>' +
          '</div>' : '') +

          // UID section
          (uidSection ? '<div class="mt-2 pt-2 border-t border-gray-50">' + uidSection + '</div>' : '') +
          verifiedBySection +

          // ACTION BUTTONS
          '<div class="flex items-center gap-2 mt-2.5 pt-2 border-t border-gray-50">' +
            buktiBtn +
            reminderBtn +
            adminWaBtn +
            adminConfirmBtn +
            adminRejectBtn +
          '</div>';

        container.appendChild(card);
    });
  }

  function sendReminderToAdmin(rowNumber, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/>' +
        '</svg>';
    }

    var item = dashboardPendingCache.find(function(d) {
      return d.rowNumber === rowNumber;
    });
    if (!item) return;

    var payload = {
      rowNumber: rowNumber,
      nama: item.nama || '',
      blok: item.blok || '',
      bulan: item.bulan || '',
      tahun: item.tahun || '',
      nominal: item.nominal || 0,
      senderEmail: currentUser ? currentUser.email : ''
    };

    gasPost_('sendPaymentReminder', { payload: payload })
      .then(function() {
        if (btnEl) {
          btnEl.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
          btnEl.className = 'flex items-center gap-1.5 text-xs font-semibold text-green-600 px-3 py-1.5 rounded-xl bg-green-50 transition';
        }
        showToast('Admin sudah diingatkan', 'success');
      })
      .catch(function() {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = 'Ingatkan Admin';
        }
        showToast('Gagal mengirim reminder', 'error');
      });
  }

  function renderUidTable(item) {
    if (uidLoadedRows.has(item.rowNumber) && item.uidList) {
      return buildUidHTML(item);
    }
    if (!item._uidLoading) {
      item._uidLoading = true;
      gasGet_('getUIDForRow', { rowNumber: item.rowNumber })
        .then(function(uidList) {
          item.uidList = uidList || [];
          uidLoadedRows.add(item.rowNumber);
          item._uidLoading = false;
          var container = document.getElementById('uid-container-' + item.rowNumber);
          if (container) { container.innerHTML = buildUidHTML(item); }
        })
        .catch(function() { item._uidLoading = false; });
    }
    return '<div class="text-sm text-gray-400 italic py-2">Memuat ID pembayaran...</div>';
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.lihat-bukti-btn');
    if (!btn) return;

    if (btn.disabled) return;

    const url = btn.dataset.bukti;
    if (!url) return;

    openBuktiViewer(url);
  });

  function renderUidTableCompact(item) {

    if (uidLoadedRows.has(item.rowNumber) && item.uidList) {
      return buildUidCompactHTML(item);
    }

    if (!item._uidLoading) {
      item._uidLoading = true;

      gasGet_('getUIDForRow', { rowNumber: item.rowNumber })
        .then(function(uidList) {
          item.uidList = uidList || [];
          uidLoadedRows.add(item.rowNumber);
          item._uidLoading = false;
          var container = document.getElementById('uid-container-' + item.rowNumber);
          if (container) { container.innerHTML = buildUidCompactHTML(item); }
        })
        .catch(function() { item._uidLoading = false; });
    }

    return '<div class="text-[11px] text-gray-300 italic">Memuat ID...</div>';
  }

  function buildUidCompactHTML(item) {
    var verifiedFmt = item.verifiedAt ? formatTanggalIndonesia(item.verifiedAt) : '';
    var verifiedRow = verifiedFmt
      ? '<div class="text-[11px] text-gray-400 mb-1">Dikonfirmasi ' + verifiedFmt + '</div>'
      : '';

    var html = verifiedRow + '<div class="flex flex-col gap-0.5">';

    // Format baru: uidList = [{bulan, blok, uid}, ...]
    var isNewFormat = item.uidList && item.uidList.length > 0 && typeof item.uidList[0] === 'object';

    if (isNewFormat) {
      item.uidList.forEach(function(entry) {
        var label = entry.bulan + ' ' + (item.tahun || '') + (entry.blok ? ' (' + entry.blok + ')' : '');
        var uid = entry.uid || '-';
        html +=
          '<div class="flex items-center justify-between">' +
            '<span class="text-[11px] text-gray-400">' + label + '</span>' +
            '<span class="text-[11px] font-mono text-gray-500 tracking-tight cursor-pointer active:opacity-60"' +
              ' onclick="copyToClipboard(this.dataset.uid)" data-uid="' + uid + '">' + uid +
              '<svg class="w-2.5 h-2.5 inline ml-1 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
            '</span>' +
          '</div>';
      });
    } else {
      // Format lama: uidList = ['uid1', 'uid2']
      var bulanArray = (item.bulan || '').toString().split(',').map(function(b) { return b.trim(); });
      bulanArray.forEach(function(bulan, index) {
        var uid = (item.uidList && item.uidList[index]) ? item.uidList[index] : '-';
        html +=
          '<div class="flex items-center justify-between">' +
            '<span class="text-[11px] text-gray-400">' + bulan + ' ' + (item.tahun || '') + '</span>' +
            '<span class="text-[11px] font-mono text-gray-500 tracking-tight cursor-pointer active:opacity-60"' +
              ' onclick="copyToClipboard(this.dataset.uid)" data-uid="' + uid + '">' + uid +
              '<svg class="w-2.5 h-2.5 inline ml-1 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
            '</span>' +
          '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function applySearchAndRender(sourceData) {

    var searchEl = document.getElementById('dashboardSearch');
    var keyword = searchEl ? searchEl.value.toLowerCase().trim() : '';

    if (!keyword) {
      renderList(sourceData);
      return;
    }

    const filtered = sourceData.filter(item => {

      const searchTarget = [
        item.nama,
        item.blok,
        item.bulan,
        item.tahun,
        item.uidList ? item.uidList.join(' ') : ''
      ]
        .join(' ')
        .toLowerCase();

      return searchTarget.includes(keyword);
    });

    renderList(filtered);
  }

  function applyFilters() {
    if (!currentUser) {
      closeDashboard();
      openLoginModal();
      return;
    }

    // 🔥 hitung ulang total tab sesuai filter
    const filteredPending = getFilteredDataForTab('pending');
    const filteredConfirmed = getFilteredDataForTab('confirmed');
    const pendingTab = document.getElementById('pendingTabCount');
    const confirmedTab = document.getElementById('confirmedTabCount');

    if (pendingTab) {
      pendingTab.innerText = filteredPending.length;
    }

    if (confirmedTab) {
      confirmedTab.innerText = filteredConfirmed.length;
    }

    // Warga: render sesuai scorecard filter
    var isAdmin = currentUser && currentUser.role === 'admin';
    if (!isAdmin) {
      var allWarga = getFilteredDataForTab('all_warga');
      var listToRender = allWarga;
      if (wargaScoreFilter === 'pending') {
        listToRender = allWarga.filter(function(i) { return i.status === 'pending'; });
      } else if (wargaScoreFilter === 'confirmed') {
        listToRender = allWarga.filter(function(i) { return i.status === 'confirmed'; });
      }
      renderList(listToRender);
      return;
    }

    // Admin: render sesuai tab aktif
    var activeData =
      activeTabType === 'pending'
        ? filteredPending
        : filteredConfirmed;
    renderList(activeData);
  }

  function getFilteredDataForTab(type) {
    var isAdmin = currentUser && currentUser.role === 'admin';

    // Warga: gabung semua data termasuk rejected, sorted terbaru dulu
    // Warga: gabung semua data termasuk rejected, sorted terbaru dulu
    if (!isAdmin) {
      var rejectedCache = dashboardCache && dashboardCache.rejected ? dashboardCache.rejected : [];
      var allData = dashboardPendingCache.concat(dashboardConfirmedCache).concat(rejectedCache);
      allData.sort(function(a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

      var userEmail = currentUser.email ? currentUser.email.trim().toLowerCase() : '';

      // Ambil daftar blok milik user dari wargaData
      var userOwnBlocks = [];
      if (Array.isArray(currentUser.wargaData) && currentUser.wargaData.length) {
        userOwnBlocks = currentUser.wargaData.map(function(d) {
          return String(d.blok || '').trim().toUpperCase();
        });
      } else if (Array.isArray(currentUser.blocks) && currentUser.blocks.length) {
        userOwnBlocks = currentUser.blocks.map(function(b) {
          return String(b).trim().toUpperCase();
        });
      }

      // Filter STRICT: email match DAN blok milik user
      var filtered = allData.filter(function(item) {
        var emailMatch = userEmail && item.email && item.email === userEmail;

        // Cek blok 1 DAN blok 2 — support multi-home
        var itemBlok1 = String(item.blok  || '').trim().toUpperCase();
        var itemBlok2 = String(item.blok2 || '').trim().toUpperCase();
        var blokMatch = userOwnBlocks.length > 0 && (
          userOwnBlocks.includes(itemBlok1) ||
          (itemBlok2 && userOwnBlocks.includes(itemBlok2))
        );

        return emailMatch && blokMatch;
      });

      // Search
      var kwWarga = (document.getElementById('dashboardSearch') ? document.getElementById('dashboardSearch').value : '').toLowerCase().trim();
      if (kwWarga) {
        filtered = filtered.filter(function(item) {
          return [item.nama, item.blok, item.bulan, item.tahun]
            .join(' ').toLowerCase().indexOf(kwWarga) !== -1;
        });
      }

      return filtered;
    }

    var source =
      type === 'pending'
        ? dashboardPendingCache
        : dashboardConfirmedCache;
    var filtered = [...source];

    // Sort terbaru di atas
    filtered.sort(function(a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    // ===== ROLE FILTER =====
    if (currentUser && currentUser.role === 'warga') {
      const userBlocks = Array.isArray(currentUser.blocks)
        ? currentUser.blocks.map(b => String(b).toUpperCase())
        : [];

      filtered = filtered.filter(item =>
        userBlocks.includes(
          String(item.blok || '').toUpperCase()
        )
      );
    }
    // ===== SEARCH =====
    const keyword =
      (document.getElementById('dashboardSearch')?.value || '')
        .toLowerCase().trim();

    if (keyword) {
      filtered = filtered.filter(item => {
        const searchTarget = [
          item.nama,
          item.blok,
          item.bulan,
          item.tahun,
          item.uidList ? item.uidList.join(' ') : ''
        ].join(' ').toLowerCase();

        return searchTarget.includes(keyword);
      });
    }
    // ===== FILTER BULAN =====
    var monthFilterEl2 = document.getElementById('monthFilterSelect');
    var selectedMonth  = monthFilterEl2 ? monthFilterEl2.value : '';
    if (selectedMonth) {
      filtered = filtered.filter(function(item) {
        var bulanStr = String(item.bulan || '').trim();
        // bulan bisa "Apr", "Jan, Feb, Mar" — cek apakah selectedMonth ada di dalamnya
        var parts = bulanStr.split(',').map(function(b) { return b.trim(); });
        return parts.some(function(p) {
          return p.toLowerCase() === selectedMonth.toLowerCase();
        });
      });
    }

    // ===== TIME FILTER =====
    if (activeTimeFilter && activeTimeFilter !== 'all') {
      const now = new Date();
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const d = new Date(item.timestamp);
        if (activeTimeFilter === 'today') {
          return d.toDateString() === now.toDateString();
        }

        if (activeTimeFilter === 'yesterday') {
          const y = new Date();
          y.setDate(now.getDate() - 1);
          return d.toDateString() === y.toDateString();
        }

        if (activeTimeFilter === 'this week') {
          const firstDay = new Date(now);
          firstDay.setDate(now.getDate() - now.getDay());
          firstDay.setHours(0,0,0,0);
          return d >= firstDay;
        }

        if (activeTimeFilter === 'this month') {
          return (
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
          );
        }
        return true;
      });
    }
    // ===== CUSTOM RANGE =====
    if (customDateRange) {
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const d = new Date(item.timestamp);
        const start = new Date(customDateRange.start);
        const end   = new Date(customDateRange.end);
        end.setHours(23,59,59,999);
        return d >= start && d <= end;
      });
    }
    // ===== RATE FILTER =====
    if (activeRateFilter) {
      filtered = filtered.filter(
        item => Number(item.nominal) === activeRateFilter
      );
    }
    return filtered;
  }

  function confirmPaymentFromUI(rowNumber) {
    if (!currentUser || currentUser.role !== 'admin') {
      showToast('Unauthorized','error');
      return;
    }

    const modal = document.getElementById('confirmModal');
    const text = modal.querySelector('p');

    text.innerText = 'Konfirmasi pembayaran ini?';
    modal.classList.remove('hidden');

    const yesBtn = modal.querySelector('button:last-child');
    const noBtn = modal.querySelector('button:first-child');

    // RESET
    yesBtn.onclick = null;
    noBtn.onclick = null;
    yesBtn.disabled = false;
    noBtn.disabled = false;
    yesBtn.innerHTML = 'Ya';

    yesBtn.onclick = function () {

      yesBtn.disabled = true;
      noBtn.disabled = true;

      yesBtn.innerHTML = `
        <span class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"
              stroke="currentColor" stroke-width="3"
              fill="none" opacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor" stroke-width="3"
              fill="none"/>
          </svg>
          Memproses...
        </span>
      `;

      gasPost_('confirmPayment', {
          rowNumber: rowNumber,
          adminEmail: currentUser.email,
          note: 'Confirmed via Dashboard'
        })
          .then(function(res) {
            try {
              modal.classList.add('hidden');
              var confirmedItem = null;
              for (var i = 0; i < dashboardPendingCache.length; i++) {
                if (dashboardPendingCache[i].rowNumber === rowNumber) {
                  confirmedItem = dashboardPendingCache[i];
                  break;
                }
              }
              dashboardPendingCache = dashboardPendingCache.filter(function(d) {
                return d.rowNumber !== rowNumber;
              });
              if (confirmedItem) {
                confirmedItem.status = 'Confirmed';
                confirmedItem.uidList = null;
                confirmedItem.uidGenerating = true;
                dashboardConfirmedCache.unshift(confirmedItem);
              }
              yesBtn.disabled = false;
              noBtn.disabled = false;
              yesBtn.innerHTML = 'Ya';
              try { sessionStorage.removeItem('dashCache'); } catch(e) {}
              applyFilters();
              updateDashboardScorecards();
              showToast('Pembayaran berhasil dikonfirmasi', 'success');
            } catch(e) {
              console.error('confirmPayment UI error:', e);
              modal.classList.add('hidden');
              yesBtn.disabled = false;
              noBtn.disabled = false;
              yesBtn.innerHTML = 'Ya';
              showToast('Pembayaran diproses, refresh untuk lihat perubahan', 'success');
            }
          })
          .catch(function(err) {
            console.error('confirmPayment server error:', err);
            yesBtn.disabled = false;
            noBtn.disabled = false;
            yesBtn.innerHTML = 'Ya';
            modal.classList.add('hidden');
            showToast('Gagal mengonfirmasi pembayaran', 'error');
          });
    };

    noBtn.onclick = function () {
      modal.classList.add('hidden');
    };
  }

  function rejectPayment(rowNumber, adminEmail) {
    let session = getCurrentUserSession(adminEmail);
    if (!session) session = forceRefreshSession_(adminEmail);
    if (!session || session.role !== 'admin') {
      return { success: false, message: 'Unauthorized' };
    }

    const sh = SpreadsheetApp
      .openById(SS_ID)
      .getSheetByName(SHEET_NAME);
    if (!sh) return { success: false, message: 'Sheet tidak ditemukan' };

    sh.getRange(rowNumber, 18).setValue('Rejected');
    sh.getRange(rowNumber, 19).setValue(adminEmail);
    sh.getRange(rowNumber, 20).setValue(new Date());

    CacheService.getScriptCache().remove('dashboard_data_light');

    return { success: true };
  }

  function rejectPaymentFromUI(rowNumber) {
    if (!currentUser || currentUser.role !== 'admin') {
      showToast('Unauthorized', 'error');
      return;
    }

    // Buka reject modal khusus
    var modal = document.getElementById('rejectModal');
    var input = document.getElementById('rejectReasonInput');
    var yesBtn = document.getElementById('rejectConfirmBtn');
    var noBtn = document.getElementById('rejectCancelBtn');
    var errorEl = document.getElementById('rejectReasonError');

    if (!modal) return;

    // Reset state
    input.value = '';
    errorEl.classList.add('hidden');
    yesBtn.disabled = true;
    yesBtn.innerHTML = 'Ya, Reject';
    modal.classList.remove('hidden');
    setTimeout(function() { input.focus(); }, 100);

    // Enable button hanya jika ada isian
    input.oninput = function() {
      var hasVal = input.value.trim().length > 0;
      yesBtn.disabled = !hasVal;
      if (hasVal) errorEl.classList.add('hidden');
    };

    yesBtn.onclick = function() {
      var alasan = input.value.trim();
      if (!alasan) {
        errorEl.classList.remove('hidden');
        input.focus();
        return;
      }

      yesBtn.disabled = true;
      noBtn.disabled = true;
      yesBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
        '<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none"/>' +
        '</svg>Memproses...</span>';

      gasPost_('rejectPayment', {
        rowNumber: rowNumber,
        adminEmail: currentUser.email,
        alasan: alasan
      })
        .then(function(res) {
          modal.classList.add('hidden');
          noBtn.disabled = false;
          if (!res || !res.success) {
            showToast(res && res.message ? res.message : 'Gagal reject', 'error');
            return;
          }
          dashboardPendingCache = dashboardPendingCache.filter(function(d) {
            return d.rowNumber !== rowNumber;
          });
          try { sessionStorage.removeItem('dashCache'); } catch(e) {}
          applyFilters();
          updateDashboardScorecards();
          showToast('Pembayaran di-reject', 'success');
        })
        .catch(function() {
          modal.classList.add('hidden');
          yesBtn.disabled = false;
          noBtn.disabled = false;
          yesBtn.innerHTML = 'Ya, Reject';
          showToast('Gagal reject pembayaran', 'error');
        });
    };

    noBtn.onclick = function() {
      modal.classList.add('hidden');
    };
  }

  function switchTab(type) {
    activeTabType = type;

    var pendingBtn    = document.getElementById('tabPending');
    var confirmedBtn  = document.getElementById('tabConfirmed');
    var wargaBaruBtn  = document.getElementById('tabWargaBaru');

    var dashList      = document.getElementById('dashboardList');
    var wargaContent  = document.getElementById('wargaBaruContent');
    var filterRow     = document.getElementById('dashboardFilterRow');
    var searchBar     = document.querySelector('#dashboardSearch')?.closest('.relative');

    var inactiveClass = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200 active:scale-95 transition tab-pill';

    if (pendingBtn)   pendingBtn.className   = inactiveClass;
    if (confirmedBtn) confirmedBtn.className = inactiveClass;
    if (wargaBaruBtn) wargaBaruBtn.className = inactiveClass;

    if (type === 'wargaBaru') {
      if (wargaBaruBtn) wargaBaruBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200 active:scale-95 transition tab-pill active';
      if (dashList)    dashList.classList.add('hidden');
      if (wargaContent) wargaContent.classList.remove('hidden');
      if (filterRow)   filterRow.classList.add('hidden');
      if (searchBar)   searchBar.classList.add('hidden');
      loadWargaBaru();
      return;
    }

    // Restore IPL tabs view
    if (dashList)    dashList.classList.remove('hidden');
    if (wargaContent) wargaContent.classList.add('hidden');
    if (filterRow)   filterRow.classList.remove('hidden');
    if (searchBar)   searchBar.classList.remove('hidden');

    if (type === 'pending') {
      if (pendingBtn) pendingBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200 active:scale-95 transition tab-pill active';
    } else {
      if (confirmedBtn) confirmedBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-green-50 text-green-700 border border-green-200 active:scale-95 transition tab-pill active';
    }

    applyFilters();
  }

  function openBuktiViewer(url) {

    if (!url) return;

    var viewer = document.getElementById('buktiViewer');
    var img = document.getElementById('buktiImage');
    var pdfContainer = document.getElementById('buktiPdfContainer');

    img.classList.add('hidden');
    img.src = '';
    pdfContainer.classList.add('hidden');
    pdfContainer.innerHTML = '';

    var match = url.match(/\/d\/(.*?)\//);
    var fileId = match ? match[1] : null;

    if (!fileId) return;

    var previewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';

    // IMAGE
    if (url.match(/\.(jpeg|jpg|png|webp)$/i)) {

      img.src = previewUrl;
      img.classList.remove('hidden');

    } else {

      var iframe = document.createElement('iframe');
      iframe.src = previewUrl;
      iframe.className = 'w-full h-[75vh] rounded-xl';
      iframe.allow = 'autoplay';

      pdfContainer.appendChild(iframe);
      pdfContainer.classList.remove('hidden');
    }

    viewer.classList.remove('hidden');
  }

  function closeBuktiViewer() {

    const viewer = document.getElementById('buktiViewer');
    const img = document.getElementById('buktiImage');
    const pdfContainer = document.getElementById('buktiPdfContainer');

    img.src = '';
    pdfContainer.innerHTML = '';
    viewer.classList.add('hidden');
  }

  /* ======================================
    SWIPE RIGHT = BACK (STABLE VERSION)
    Applies to: #sheet & #dashboard
  ====================================== */
  (function () {

    const SWIPE_THRESHOLD = 80; // jarak minimal swipe
    const EDGE_LIMIT = 40;      // hanya aktif dari tepi kiri

    function enableSwipeRightBack(container, onBack) {

      if (!container) return;

      let startX = 0;
      let startY = 0;
      let tracking = false;

      container.addEventListener('touchstart', function (e) {

        const t = e.touches[0];

        // hanya aktif jika swipe dimulai dari kiri layar
        if (t.clientX > EDGE_LIMIT) return;

        startX = t.clientX;
        startY = t.clientY;
        tracking = true;

      }, { passive: true });

      container.addEventListener('touchmove', function (e) {

        if (!tracking) return;

        const t = e.touches[0];

        const deltaX = t.clientX - startX;
        const deltaY = t.clientY - startY;

        // dominan horizontal & swipe ke kanan
        if (
          deltaX > SWIPE_THRESHOLD &&
          Math.abs(deltaY) < 70
        ) {
          tracking = false;
          onBack();
        }

      }, { passive: true });

      container.addEventListener('touchend', function () {
        tracking = false;
      });

    }

    document.addEventListener('DOMContentLoaded', function () {

      enableSwipeRightBack(
        document.getElementById('sheet'),
        function () { closeSheet(); }
      );

      enableSwipeRightBack(
        document.getElementById('dashboard'),
        function () { closeDashboard(); }
      );

    });

  })();

  /* ======================================
    ANDROID BACK BUTTON / GESTURE SUPPORT
  ====================================== */
  window.addEventListener('popstate', function (event) {

    // Kalau sheet terbuka → tutup sheet
    if (document.body.classList.contains('ipl-form-open')) {
      closeSheet();
      return;
    }

    const sayaEl = document.getElementById('pageSaya');
    if (sayaEl && !sayaEl.classList.contains('hidden')) {
      closePageSaya();
      return;
    }

    var mudikEl = document.getElementById('formMudik');
    if (mudikEl && mudikEl.style.opacity === '1') {
      closeFormMudik();
      return;
    }

    var renovEl = document.getElementById('formRenovasi');
    if (renovEl && renovEl.style.opacity === '1') {
      closeFormRenovasi();
      return;
    }

    // Kalau dashboard terbuka → tutup dashboard
    var pedomanEl = document.getElementById('pedomanViewer');
    if (pedomanEl && !pedomanEl.classList.contains('hidden')) {
      closePedomanViewer();
      return;
    }

    // Kalau dashboard terbuka → tutup dashboard
    const dashboardEl = document.getElementById('dashboard');
    if (dashboardEl && !dashboardEl.classList.contains('hidden')) {
      closeDashboard();
      return;
    }
  });

document.addEventListener('click', function (e) {
  const btn = document.getElementById('headerAuthBtn');
  const dropdown = document.getElementById('headerDropdown');

  if (!btn || !dropdown) return;

  if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

/* ================= FEEDBACK SYSTEM ================= */

let selectedRating = 0;

function openFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  modal.classList.remove('hidden');
  renderStars();
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  modal.classList.add('hidden');
  selectedRating = 0;
  document.getElementById('feedbackRemark').value = '';
}

function renderStars() {
  const container = document.getElementById('starContainer');
  container.innerHTML = '';

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.innerHTML = '★';
    star.className = 'text-3xl cursor-pointer transition';

    star.style.color = i <= selectedRating ? '#43A047' : '#d1d5db';

    star.onclick = () => {
      selectedRating = i;
      renderStars();
    };

    container.appendChild(star);
  }
}

function submitFeedback() {

  if (!selectedRating) {
    showToast('Silakan pilih rating terlebih dahulu', 'warning');
    return;
  }

  if (!currentUser || !currentUser.email) {
    showToast('Session tidak ditemukan', 'error');
    return;
  }

  const btn = document.getElementById('feedbackSubmitBtn');
  const spinner = document.getElementById('feedbackSpinner');
  const text = document.getElementById('feedbackBtnText');

  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (text) text.textContent = 'Mengirim...';

  const remark = document.getElementById('feedbackRemark').value;

  // ⏱️ minimum loading 600ms (biar smooth)
  const startTime = Date.now();

  gasPost_('saveWargaFeedback', { payload: { email: currentUser.email, rate: selectedRating, remark: remark } })
    .then(function(res) {
      var elapsed = Date.now() - startTime;
      var delay = Math.max(600 - elapsed, 0);
      setTimeout(function() {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (text) text.textContent = 'Kirim';
        if (res && res.success) {
          closeFeedbackModal();
          showToast('Terima kasih atas feedback Anda','success');
        } else {
          showToast('Gagal menyimpan feedback', 'error');
        }
      }, delay);
    })
    .catch(function() {
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (text) text.textContent = 'Kirim';
      showToast('Terjadi kesalahan sistem', 'error');
    });
}

function switchPage(targetId){

  const pages = [
    'homePage',
    'dashboard',
    'pageSaya',
    'laporPage',
    'explorePage'
  ];

  pages.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;

    if(id === targetId){
      el.classList.remove('hidden');
      el.classList.add('active');
    }else{
      el.classList.remove('active');
      el.classList.add('hidden');

    }

  });
}

function updateHomeGreeting() {
  const greetEl = document.getElementById('homeGreeting');
  const nameEl  = document.getElementById('homeUsername');
  if (!greetEl || !nameEl) return;

  const hour = new Date().getHours();
  const g = _getGreetingHTML_(hour);
  const greetHTML = g.svg + g.text;

  greetEl.innerHTML = greetHTML;

  // Sync to desktop topbar — with SVG icon
  var tg = document.getElementById('desktopTopbarGreeting');
  if (tg) tg.innerHTML = greetHTML;

  if (currentUser && currentUser.fullName) {
    var displayName = currentUser.fullName;
    var isAdmin = currentUser.role === 'admin';

    if (isAdmin) {
      nameEl.innerHTML = '<span style="background:linear-gradient(90deg,#B8860B,#FFD700,#B8860B);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">' +
        displayName +
        '</span>' +
        '<span style="font-size:11px;font-weight:600;color:#B8860B;background:#FFF8DC;border:1px solid #FFD700;border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:middle">Admin</span>';
    } else {
      nameEl.innerText = displayName;
    }
  } else if (currentUser && currentUser.email) {
    nameEl.innerText = currentUser.email.split('@')[0];
    if (tu) tu.textContent = currentUser.email.split('@')[0];
  } else {
    nameEl.innerText = 'Warga JPS2';
    if (tu) tu.textContent = 'Warga JPS2';
  }
}

// ============================================================
// HOME PAGE FUNCTIONS
// ============================================================

var homeDataCache = { fasum: null, info: null, tunggakan: null, contact: null, security: null };

function loadHomeData() {
  updateHomeGreeting();
  loadHeaderGreeting();
  loadHomeTunggakan();
  loadHomeFasum();
  loadHomeInfo();
  _updatePedomanHint_();
  preloadContactData();
  preloadSecurityContacts();
}

function _updatePedomanHint_() {
  var hint = document.getElementById('pedomanLoginHint');
  if (!hint) return;
  if (!currentUser) {
    hint.classList.remove('hidden');
    hint.classList.add('flex');
  } else {
    hint.classList.add('hidden');
    hint.classList.remove('flex');
  }
}

function loadHomeDataIfNeeded() {
    updateHomeGreeting();
    if (!homeDataCache.greeting) {
      loadHeaderGreeting();
    } else {
      startGreetingBanner_(homeDataCache.greeting); // items array
    }
    if (!homeDataCache.tunggakan) loadHomeTunggakan();
    if (!homeDataCache.fasum) loadHomeFasum();
    if (!homeDataCache.info) loadHomeInfo();
    if (!homeDataCache.contact) preloadContactData();
    if (!homeDataCache.security) preloadSecurityContacts();
    _updatePedomanHint_();
  }

function loadHeaderGreeting() {

  gasGet_('getActiveGreeting')
    .then(function(res) {
      if (!res || !res.success || !res.text) {
        // Tidak ada greeting aktif — sembunyikan banner
        var wrap = document.getElementById('greetingBannerWrap');
        if (wrap) wrap.classList.add('hidden');
        return;
      }
      var items = res.items || (Array.isArray(res.texts)
        ? res.texts.map(function(t){ return { judul: t, konten: '' }; })
        : [{ judul: res.text || '', konten: '' }]);
      homeDataCache.greeting = items;
      startGreetingBanner_(items);
    })
    .catch(function() {});
}

var _greetingToken_ = 0; // incremented every new run — old runs self-cancel

function startGreetingRotation_(greetings, textEl, greetEl) {
  if (!greetings || !greetings.length) return;

  // Kill all previous runs
  _greetingToken_++;
  var myToken = _greetingToken_;

  greetEl.classList.remove('hidden');
  textEl.innerText = '';
  textEl.style.borderRight = '';
  textEl.style.animation = '';

  var idx = 0;

  function alive() { return myToken === _greetingToken_; }

  function cursorOn()  {
    textEl.style.borderRight = '2px solid rgba(255,255,255,0.85)';
    textEl.style.animation   = 'greetCursor 0.5s step-end infinite';
  }
  function cursorOff() {
    textEl.style.borderRight = '';
    textEl.style.animation   = '';
  }

  function typeText(text, onDone) {
    if (!alive()) return;
    textEl.innerText = '';
    cursorOn();
    var i = 0;
    (function tick() {
      if (!alive()) return;
      if (i <= text.length) {
        textEl.innerText = text.slice(0, i);
        i++;
        setTimeout(tick, 55);
      } else {
        cursorOff();
        if (onDone) setTimeout(onDone, greetings.length > 1 ? 2800 : 9999999);
      }
    })();
  }

  function eraseText(onDone) {
    if (!alive()) return;
    cursorOn();
    var str = textEl.innerText;
    var i   = str.length;
    (function tick() {
      if (!alive()) return;
      if (i >= 0) {
        textEl.innerText = str.slice(0, i);
        i--;
        setTimeout(tick, 28);
      } else {
        cursorOff();
        if (onDone) setTimeout(onDone, 180);
      }
    })();
  }

  function showNext() {
    if (!alive()) return;
    if (greetings.length > 1) {
      eraseText(function() {
        if (!alive()) return;
        idx = (idx + 1) % greetings.length;
        typeText(greetings[idx], showNext);
      });
    }
  }

  // Small delay so page-transition animation doesn't overlap
  setTimeout(function() {
    if (!alive()) return;
    typeText(greetings[0], showNext);
  }, 300);
}

function preloadContactData() {
  if (homeDataCache.contact) return; // sudah ada
  gasGet_('getNonSecurityContacts')
    .then(function(res) { homeDataCache.contact = res; })
    .catch(function() {});
}

function preloadSecurityContacts() {
  if (homeDataCache.security) return; // sudah ada
  gasGet_('getSecurityContacts')
    .then(function(res) { homeDataCache.security = res; })
    .catch(function() {});
}

// --- TUNGGAKAN ---
function loadHomeTunggakan() {
  const nomEl   = document.getElementById('homeIplNominal');
  const badgeEl = document.getElementById('homeIplBadge');
  if (!nomEl) return;

  if (!currentUser || !currentUser.email) {
    nomEl.innerHTML = 'Rp&nbsp;<span style="letter-spacing:2px">••••••</span>';
    badgeEl.innerText = '—';
    badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';

    var monthEl = document.getElementById('homeIplMonth');
    if (monthEl) monthEl.innerText = 's.d. bulan ini';

    // CTA button
    var ctaEl = document.getElementById('tunggakanLoginCTA');
    if (!ctaEl) {
      var card = document.getElementById('homeTunggakanCard');
      if (card) {
        var cta = document.createElement('button');
        cta.id = 'tunggakanLoginCTA';
        cta.onclick = function() { openPageSaya(); };
        cta.className = 'mt-3 px-4 py-1.5 rounded-xl bg-white text-primary text-xs font-bold active:scale-95 transition inline-block relative z-10';
        cta.innerText = 'Masuk sekarang →';
        var zEl = card.querySelector('.relative.z-10');
        if (zEl) zEl.appendChild(cta);
      }
    }
    return;
  }

  // hapus CTA jika sudah login
  var ctaEl = document.getElementById('tunggakanLoginCTA');
  if (ctaEl) ctaEl.remove();

  nomEl.innerText = 'Memuat...';
  gasGet_('getWargaTunggakan', { email: currentUser.email })
    .then(function(res) {
      console.log('[tunggakan res]', JSON.stringify(res));
      homeDataCache.tunggakan = res;
      if (!res || !res.ok) {
        nomEl.innerHTML = 'Rp 0';
        badgeEl.innerHTML = '<span style="display:flex;align-items:center;gap:5px;"><svg style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Lunas</span>';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';
        var labelElFail = document.querySelector('#homeTunggakanCard .text-green-200');
        if (labelElFail) labelElFail.innerText = 'Status IPL';
        var monthElFail = document.getElementById('homeIplMonth');
        if (monthElFail) monthElFail.innerText = 'Tidak ada tagihan saat ini';
        return;
      }
      const monthEl = document.getElementById('homeIplMonth');
      if (monthEl) {
        if (res.items && res.items.length > 0) {
          const last = res.items[res.items.length - 1];
          const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
          monthEl.innerText = 's.d. ' + (monthNames[last.monthIdx0] || '') + ' ' + (last.year || '');
        } else {
          const now = new Date();
          const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
          monthEl.innerText = monthNames[now.getMonth()] + ' ' + now.getFullYear();
        }
      }
      if (res.total === 0) {
        var monthNames2 = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        var now2 = new Date();
        var paidNow = (wargaPaidMonths && wargaPaidMonths[now2.getFullYear()]) || [];
        var nextUnpaidMonth = -1;
        for (var mi = now2.getMonth(); mi < 12; mi++) {
          if (!paidNow.includes(mi)) { nextUnpaidMonth = mi; break; }
        }
        var hasUpcoming = res.upcoming > 0 && nextUnpaidMonth >= 0;
        if (hasUpcoming) {
          nomEl.innerText = 'Rp ' + Number(res.upcoming).toLocaleString('id-ID');
        } else {
          nomEl.innerText = 'Rp 0';
          nomEl.style.fontSize = '1.5rem';
        }

        // === HITUNG FASE JATUH TEMPO ===
        var dueDatePhase = 'normal'; // normal | warning | overdue | late
        var dueBadgeText = '';
        var cardBg = hasUpcoming ? '#2E7D32' : 'linear-gradient(135deg, #1B5E20, #2E7D32)';

        if (hasUpcoming && res.dueDate) {
          var today = new Date();
          // var today = new Date('2026-04-25');
          today.setHours(0, 0, 0, 0);
          var due = new Date(res.dueDate);
          due.setHours(0, 0, 0, 0);
          var diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

          if (diffDays > 7) {
            // Normal — hijau
            dueDatePhase = 'normal';
          } else if (diffDays >= 1) {
            // Reminder H-7 s/d H-1 — kuning
            dueDatePhase = 'reminder';
            dueBadgeText = 'bell|Jatuh tempo ' + diffDays + ' hari lagi';
            cardBg = 'linear-gradient(135deg, #713f12, #ca8a04)';
          } else if (diffDays === 0) {
            // Hari H — oranye
            dueDatePhase = 'due';
            dueBadgeText = 'clock|Jatuh tempo hari ini';
            cardBg = 'linear-gradient(135deg, #7c2d12, #ea580c)';
          } else if (diffDays >= -7) {
            // Overdue H+1 s/d H+7 — merah
            dueDatePhase = 'overdue';
            dueBadgeText = 'alert|Terlambat ' + Math.abs(diffDays) + ' hari';
            cardBg = 'linear-gradient(135deg, #7f1d1d, #b91c1c)';
          } else {
            // Late H+7+ — merah gelap
            dueDatePhase = 'late';
            dueBadgeText = 'alert|Terlambat ' + Math.abs(diffDays) + ' hari';
            cardBg = 'linear-gradient(135deg, #3b0a0a, #7f1d1d)';
          }
        }

        badgeEl.innerHTML = '<span style="display:flex;align-items:center;gap:5px;"><svg style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Lunas</span>';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white';
        var labelEl = document.querySelector('#homeTunggakanCard .text-green-200');
        var cardLabel = 'Status IPL';
        if (hasUpcoming) {
          if (dueDatePhase === 'due') cardLabel = 'Jatuh Tempo Hari Ini';
          else if (dueDatePhase === 'overdue') cardLabel = 'Segera Lunasi';
          else if (dueDatePhase === 'late') cardLabel = 'Tunggakan Belum Dibayar';
          else cardLabel = 'Tagihan Berikutnya';
        }
        if (labelEl) labelEl.innerText = cardLabel;
        var monthEl2 = document.getElementById('homeIplMonth');
        if (monthEl2) {
          if (hasUpcoming) {
            monthEl2.innerText = monthNames2[nextUnpaidMonth] + ' ' + now2.getFullYear();
          } else {
            monthEl2.innerText = 'Tidak ada tagihan saat ini';
          }
        }

        // Tambah badge fase jatuh tempo
        var existingDueBadge = document.getElementById('dueDateBadge');
        if (existingDueBadge) existingDueBadge.remove();
        if (dueBadgeText) {
          var badgeParts = dueBadgeText.split('|');
          var badgeIcon  = badgeParts[0];
          var badgeLabel = badgeParts[1] || '';

          var iconSvg = '';
          if (badgeIcon === 'bell') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
          } else if (badgeIcon === 'clock') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
          } else if (badgeIcon === 'alert') {
            iconSvg = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
          }

          var dueBadgeEl = document.createElement('div');
          dueBadgeEl.id = 'dueDateBadge';
          dueBadgeEl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.92);margin-top:6px;';
          dueBadgeEl.innerHTML = iconSvg + '<span>' + badgeLabel + '</span>';
          var nomParent = nomEl.parentElement;
          if (nomParent) nomParent.appendChild(dueBadgeEl);
        }

        var card = document.getElementById('homeTunggakanCard');
        if (card) {
          card.style.background = cardBg;
        }
      } else {
        nomEl.innerText = 'Rp ' + Number(res.total).toLocaleString('id-ID');
        badgeEl.innerText = res.items.length + ' bulan';
        badgeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-red-400/80 text-white';
        var labelEl = document.querySelector('#homeTunggakanCard .text-green-200');
        if (labelEl) labelEl.innerText = 'Total Tunggakan';

        // Hitung fase overdue untuk tunggakan
        if (res.dueDate) {
          var todayOvd = new Date();
          todayOvd.setHours(0, 0, 0, 0);
          var dueOvd = new Date(res.dueDate);
          dueOvd.setHours(0, 0, 0, 0);
          var diffOvd = Math.round((dueOvd - todayOvd) / (1000 * 60 * 60 * 24));

          var ovdBg = '';
          var ovdBadgeIcon = '';
          var ovdBadgeText = '';

          if (diffOvd >= 1) {
            ovdBg = 'linear-gradient(135deg, #713f12, #ca8a04)';
            ovdBadgeIcon = 'bell';
            ovdBadgeText = 'Jatuh tempo ' + diffOvd + ' hari lagi';
          } else if (diffOvd === 0) {
            ovdBg = 'linear-gradient(135deg, #7c2d12, #ea580c)';
            ovdBadgeIcon = 'clock';
            ovdBadgeText = 'Jatuh tempo hari ini';
            if (labelEl) labelEl.innerText = 'Jatuh Tempo Hari Ini';
          } else if (diffOvd >= -7) {
            ovdBg = 'linear-gradient(135deg, #7f1d1d, #b91c1c)';
            ovdBadgeIcon = 'alert';
            ovdBadgeText = 'Terlambat ' + Math.abs(diffOvd) + ' hari';
            if (labelEl) labelEl.innerText = 'Segera Lunasi';
          } else {
            ovdBg = 'linear-gradient(135deg, #3b0a0a, #7f1d1d)';
            ovdBadgeIcon = 'alert';
            ovdBadgeText = 'Terlambat ' + Math.abs(diffOvd) + ' hari';
            if (labelEl) labelEl.innerText = 'Tunggakan Belum Dibayar';
          }

          var cardOvd = document.getElementById('homeTunggakanCard');
          if (cardOvd && ovdBg) cardOvd.style.background = ovdBg;

          // Render badge
          var existingOvdBadge = document.getElementById('dueDateBadge');
          if (existingOvdBadge) existingOvdBadge.remove();

          if (ovdBadgeText) {
            var iconSvgOvd = '';
            if (ovdBadgeIcon === 'bell') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
            } else if (ovdBadgeIcon === 'clock') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
            } else if (ovdBadgeIcon === 'alert') {
              iconSvgOvd = '<svg style="width:13px;height:13px;flex-shrink:0;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
            }
            var ovdBadgeEl = document.createElement('div');
            ovdBadgeEl.id = 'dueDateBadge';
            ovdBadgeEl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.92);margin-top:6px;';
            ovdBadgeEl.innerHTML = iconSvgOvd + '<span>' + ovdBadgeText + '</span>';
            var nomParentOvd = nomEl.parentElement;
            if (nomParentOvd) nomParentOvd.appendChild(ovdBadgeEl);
          }
        }
      }
      if (res.rate) {
        updateTarifDisplay_(true);

        var isMultiBlok = res.bloks && res.bloks.length > 1;
        var allSame200 = isMultiBlok && (Number(res.rate) % 200000 === 0) && (Number(res.rate) / 200000 === res.bloks.length);
        var allSame175 = isMultiBlok && (Number(res.rate) % 175000 === 0) && (Number(res.rate) / 175000 === res.bloks.length);
        var mixedRate  = isMultiBlok && !allSame200 && !allSame175;

        var rate200 = Number(res.rate) === 200000 || allSame200 || mixedRate;
        var rate175 = Number(res.rate) === 175000 || allSame175 || mixedRate;

        var card200   = document.getElementById('tarifCard200');
        var card175   = document.getElementById('tarifCard175');
        var p200nom   = document.getElementById('tarifNominal200');
        var p175nom   = document.getElementById('tarifNominal175');
        var p200label = card200 ? card200.querySelector('p:first-child') : null;
        var p175label = card175 ? card175.querySelector('p:first-child') : null;

        // Hitung label blok per card
        var blokLabel200 = '';
        var blokLabel175 = '';
        if (isMultiBlok && res.bloks) {
          var allBloks = res.bloks.join(' & ');
          if (allSame200) {
            blokLabel200 = ' (' + allBloks + ')';
            blokLabel175 = '';
          } else if (allSame175) {
            blokLabel200 = '';
            blokLabel175 = ' (' + allBloks + ')';
          } else {
            var rateByBlok = res.rateByBlok || {};
            var bloks200 = res.bloks.filter(function(b) { return (rateByBlok[b] || 0) >= 200000; });
            var bloks175 = res.bloks.filter(function(b) { return (rateByBlok[b] || 0) < 200000 && (rateByBlok[b] || 0) > 0; });
            blokLabel200 = bloks200.length ? ' (' + bloks200.join(' & ') + ')' : '';
            blokLabel175 = bloks175.length ? ' (' + bloks175.join(' & ') + ')' : '';
          }
        }

        if (card200) {
          if (rate200) {
            card200.style.background   = '#f0fdf4';
            card200.style.borderTop    = '3px solid #16a34a';
            card200.style.borderRight  = '1px solid #bbf7d0';
            card200.style.borderBottom = '1px solid #bbf7d0';
            card200.style.borderLeft   = '1px solid #bbf7d0';
            card200.style.opacity      = '1';
            if (p200nom) { p200nom.style.color = '#15803d'; }
          } else {
            card200.style.background   = '#fafafa';
            card200.style.borderTop    = '3px solid transparent';
            card200.style.borderRight  = '1px solid #f3f4f6';
            card200.style.borderBottom = '1px solid #f3f4f6';
            card200.style.borderLeft   = '1px solid #f3f4f6';
            card200.style.opacity      = '0.5';
            if (p200nom) { p200nom.style.color = ''; }
          }
          if (!document.getElementById('tarifBadge200') && rate200 && p200label) {
            var badge200 = document.createElement('span');
            badge200.id = 'tarifBadge200';
            badge200.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:999px;padding:2px 7px;margin-left:6px;letter-spacing:0.02em;vertical-align:middle;';
            badge200.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Tarif Anda';
            p200label.appendChild(badge200);
          }
          if (isMultiBlok && blokLabel200 && !document.getElementById('tarifBlokLabel200') && p200label) {
            var blokSpan200 = document.createElement('span');
            blokSpan200.id = 'tarifBlokLabel200';
            blokSpan200.style.cssText = 'display:block;font-size:9px;color:#43A047;font-weight:600;margin-top:2px;';
            blokSpan200.innerText = blokLabel200;
            p200label.appendChild(blokSpan200);
          }
        }
        if (card175) {
          if (rate175) {
            card175.style.background   = '#f0fdf4';
            card175.style.borderTop    = '3px solid #16a34a';
            card175.style.borderRight  = '1px solid #bbf7d0';
            card175.style.borderBottom = '1px solid #bbf7d0';
            card175.style.borderLeft   = '1px solid #bbf7d0';
            card175.style.opacity      = '1';
            if (p175nom) { p175nom.style.color = '#15803d'; }
          } else {
            card175.style.background   = '#fafafa';
            card175.style.borderTop    = '3px solid transparent';
            card175.style.borderRight  = '1px solid #f3f4f6';
            card175.style.borderBottom = '1px solid #f3f4f6';
            card175.style.borderLeft   = '1px solid #f3f4f6';
            card175.style.opacity      = '0.5';
            if (p175nom) { p175nom.style.color = ''; }
          }
          if (!document.getElementById('tarifBadge175') && rate175 && p175label) {
            var badge175 = document.createElement('span');
            badge175.id = 'tarifBadge175';
            badge175.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:999px;padding:2px 7px;margin-left:6px;letter-spacing:0.02em;vertical-align:middle;';
            badge175.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Tarif Anda';
            p175label.appendChild(badge175);
          }
          if (isMultiBlok && blokLabel175 && !document.getElementById('tarifBlokLabel175') && p175label) {
            var blokSpan175 = document.createElement('span');
            blokSpan175.id = 'tarifBlokLabel175';
            blokSpan175.style.cssText = 'display:block;font-size:9px;color:#15803d;font-weight:600;margin-top:2px;';
            blokSpan175.innerText = blokLabel175;
            p175label.appendChild(blokSpan175);
          }
        }
        if (p200label) p200label.style.color = rate200 ? '#15803d' : '#6b7280';
        if (p175label) p175label.style.color = rate175 ? '#15803d' : '#6b7280';
      }
    })
    .catch(function() {
      nomEl.innerText = 'Gagal memuat';
    });
}

function openTunggakanDetail() {
  var cache = homeDataCache.tunggakan;
  var modal = document.getElementById('tunggakanModal');
  if (!modal) return;

  if (!currentUser || !currentUser.email) {
    openPageSaya();
    return;
  }

  var blokEl  = document.getElementById('tunggakanModalBlok');
  var listEl  = document.getElementById('tunggakanModalList');
  var totalEl = document.getElementById('tunggakanModalTotal');

  if (!cache || !cache.ok) {
    showToast('Data belum tersedia, coba refresh', 'warning');
    return;
  }

  blokEl.innerText  = 'Blok ' + (cache.blok || '-');
  totalEl.innerText = 'Rp ' + Number(cache.total || 0).toLocaleString('id-ID');

  // Tambah info jatuh tempo di modal
  var existingDueInfo = document.getElementById('tunggakanModalDueInfo');
  if (existingDueInfo) existingDueInfo.remove();

  if (cache.dueDate && cache.upcoming > 0) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var due = new Date(cache.dueDate);
    due.setHours(0, 0, 0, 0);
    var diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

    var dueText = '';
    var dueColor = '';
    if (diffDays > 7) {
      dueText = 'Jatuh tempo ' + due.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      dueColor = '#43A047';
    } else if (diffDays >= 1) {
      dueText = '🔔 Jatuh tempo ' + diffDays + ' hari lagi (' + due.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ')';
      dueColor = '#b45309';
    } else if (diffDays === 0) {
      dueText = '⏰ Jatuh tempo hari ini';
      dueColor = '#ea580c';
    } else if (diffDays >= -7) {
      dueText = '⚠️ Terlambat ' + Math.abs(diffDays) + ' hari';
      dueColor = '#b91c1c';
    } else {
      dueText = '⚠️ Terlambat ' + Math.abs(diffDays) + ' hari';
      dueColor = '#7f1d1d';
    }

    var dueInfoEl = document.createElement('div');
    dueInfoEl.id = 'tunggakanModalDueInfo';
    dueInfoEl.style.cssText = 'font-size:12px;font-weight:600;color:' + dueColor + ';padding:8px 0 4px 0;';
    dueInfoEl.innerText = dueText;
    blokEl.parentElement.insertBefore(dueInfoEl, blokEl.nextSibling);
  }

  var upcomingItem = cache.upcomingItem || null;
  var grandTotal = (cache.total || 0) + (upcomingItem ? upcomingItem.amount : 0);

  if (!cache.items || cache.items.length === 0) {
    if (!upcomingItem) {
      listEl.innerHTML =
        '<div class="flex flex-col items-center py-6 gap-2">' +
          '<div class="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center">' +
            '<svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M20 6L9 17l-5-5"/>' +
            '</svg>' +
          '</div>' +
          '<p class="text-sm font-semibold text-gray-900">Semua lunas!</p>' +
          '<p class="text-xs text-gray-400">Tidak ada tunggakan IPL</p>' +
        '</div>';
    } else {
      listEl.innerHTML = '';
    }
  } else {
    listEl.innerHTML = cache.items.map(function(d) {
      var amt = 'Rp ' + Number(d.amount || 0).toLocaleString('id-ID');
      var lbl = (d.name || '') + (d.year ? ' ' + d.year : '');
      var isOverdue = d.year < new Date().getFullYear() ||
        (d.year === new Date().getFullYear() && d.monthIdx0 < new Date().getMonth());
      return '<div class="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:' + (isOverdue ? '#f87171' : '#fbbf24') + ';"></div>' +
          '<span class="text-sm text-gray-700">' + lbl + '</span>' +
        '</div>' +
        '<span class="text-sm font-semibold" style="color:' + (isOverdue ? '#dc2626' : '#374151') + ';">' + amt + '</span>' +
      '</div>';
    }).join('');
  }

  // Tambah upcoming item jika ada
  if (upcomingItem) {
    var upAmt = 'Rp ' + Number(upcomingItem.amount).toLocaleString('id-ID');
    var upLbl = upcomingItem.name + ' ' + upcomingItem.year + ' (Upcoming)';
    listEl.innerHTML +=
      '<div class="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:#0d9488;"></div>' +
          '<span class="text-sm" style="color:#0d9488;">' + upLbl + '</span>' +
        '</div>' +
        '<span class="text-sm font-semibold" style="color:#0d9488;">' + upAmt + '</span>' +
      '</div>';
  }

  // Update total & tombol bayar
  totalEl.innerText = 'Rp ' + Number(grandTotal).toLocaleString('id-ID');
  var bayarBtn = document.getElementById('tunggakanBayarBtn');
  if (bayarBtn) {
    bayarBtn.innerText = 'Bayar Sekarang';
  }

  modal.classList.remove('hidden');
}

function closeTunggakanModal() {
  document.getElementById('tunggakanModal').classList.add('hidden');
}

// --- FASUM ---
var FASUM_ICON_SVG = {
  gate : '<path d="M3 21h18M3 7v14M21 7v14M6 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3"/><rect x="9" y="11" width="6" height="10"/>',
  cctv : '<path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.868v6.264a1 1 0 0 1-1.447.937L15 14"/><rect x="2" y="7" width="13" height="10" rx="2"/>',
  park : '<path d="M12 22V12"/><path d="M5 12a7 7 0 0 0 7-7 7 7 0 0 0 7 7"/><path d="M5 19a7 7 0 0 0 7-7 7 7 0 0 0 7 7"/>',
  lamp : '<path d="M12 2v6"/><path d="M9.17 3.17A8 8 0 0 0 12 18"/><path d="M14.83 3.17A8 8 0 0 1 12 18"/><path d="M8 22h8M12 18v4"/>',
  pool : '<path d="M2 12h20M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M6 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/>',
  road : '<path d="M3 3h18v4H3z"/><path d="M3 17h18v4H3z"/><path d="M11 7v10M13 7v10"/>',
  power: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  water: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/>',
  hall : '<path d="M3 11.5L12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>',
  trash: '<path d="M3 6h18M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>',
  sport: '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c4.08 4.08 10.14 4.08 14.14 0"/><path d="M4.93 19.07c4.08-4.08 10.14-4.08 14.14 0"/><path d="M12 2v20"/>'
};

function getFasumIconSvg(key) {
  return FASUM_ICON_SVG[key] ||
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>';
}

function getFasumStatusStyle(status) {
  var s = (status || '').toLowerCase();
  if (s === 'normal')      return { dot: 'bg-green-400',  text: 'text-green-700',  label: 'Normal',      cardBg: 'bg-gradient-to-b from-green-50 to-white',  cardBorder: 'border-green-100', iconBg: 'bg-green-500',  iconColor: 'text-white', pillBg: 'bg-green-100', pillText: 'text-green-700' };
  if (s === 'maintenance') return { dot: 'bg-amber-400',  text: 'text-amber-700',  label: 'Maintenance', cardBg: 'bg-gradient-to-b from-amber-50 to-white',  cardBorder: 'border-amber-100', iconBg: 'bg-amber-400',  iconColor: 'text-white', pillBg: 'bg-amber-100', pillText: 'text-amber-700' };
  return                          { dot: 'bg-red-400',    text: 'text-red-700',    label: status || 'Gangguan', cardBg: 'bg-gradient-to-b from-red-50 to-white', cardBorder: 'border-red-100', iconBg: 'bg-red-500', iconColor: 'text-white', pillBg: 'bg-red-100', pillText: 'text-red-700' };
}

function loadHomeFasum() {
  const el = document.getElementById('homeFasumList');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = '<div class="col-span-3 flex flex-col items-center justify-center gap-2 py-6 px-4">' +
      '<div class="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500 text-center">Login untuk melihat Info Fasum</p>' +
      '<button onclick="openMePage()" class="mt-1 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl active:scale-95 transition">Masuk Sekarang</button>' +
    '</div>';
    return;
  }

  gasGet_('getFasumData')
    .then(function(res) {
      homeDataCache.fasum = res;
      if (!res || !res.ok || !res.data.length) {
        el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Data fasum belum tersedia</p>';
        return;
      }
      renderFasumList(false);
    })
    .catch(function() {
      document.getElementById('homeFasumList').innerHTML =
        '<p class="text-sm text-red-400 text-center py-4">Gagal memuat data fasum</p>';
    });
}

function buildFasumItemHtml(f) {
  var st  = getFasumStatusStyle(f.status);
  var ico = getFasumIconSvg(f.icon);
  return '<div class="fasum-card rounded-2xl border ' + st.cardBorder + ' ' + st.cardBg + ' flex flex-col items-center pt-3.5 pb-3 px-2 gap-1.5">' +
    '<div class="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm ' + st.iconBg + '">' +
      '<svg class="w-5 h-5 ' + st.iconColor + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
        ico +
      '</svg>' +
    '</div>' +
    '<p class="text-[10.5px] font-bold text-gray-800 leading-snug text-center line-clamp-2 w-full">' + f.nama + '</p>' +
    '<div class="flex items-center gap-1 rounded-full px-2 py-0.5 mt-auto ' + st.pillBg + '">' +
      '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0 ' + st.dot + '"></div>' +
      '<span class="text-[9px] font-semibold ' + st.pillText + ' whitespace-nowrap">' + st.label + '</span>' +
    '</div>' +
  '</div>';
}

function renderFasumList(showAll) {
  var el  = document.getElementById('homeFasumList');
  var res = homeDataCache.fasum;
  if (!el || !res || !res.data) return;

  el.className = 'grid grid-cols-3 gap-2.5 px-4 pb-4 pt-2';
  el.innerHTML = res.data.map(buildFasumItemHtml).join('');
}

// --- INFO CLUSTER ---
var KATEGORI_META = {
  'pengumuman' : { bg: 'bg-blue-500',   emoji: '📢' },
  'keamanan'   : { bg: 'bg-red-500',    emoji: '🔒' },
  'lingkungan' : { bg: 'bg-green-600',  emoji: '🌿' },
  'sosial'     : { bg: 'bg-purple-500', emoji: '🤝' },
  'keuangan'   : { bg: 'bg-orange-500', emoji: '💰' },
  'event'      : { bg: 'bg-pink-500',   emoji: '🎉' },
  'fasilitas'  : { bg: 'bg-teal-500',   emoji: '🏗️' }
};

function getKategoriMeta(kat) {
  return KATEGORI_META[(kat || '').toLowerCase()] || { bg: 'bg-gray-500', emoji: '📌' };
}

function loadHomeInfo() {
  const el = document.getElementById('homeInfoCarousel');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = '<div class="flex-shrink-0 w-full flex flex-col items-center justify-center gap-2 py-6 px-4 snap-start">' +
      '<div class="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500 text-center">Login untuk melihat Info Cluster</p>' +
      '<button onclick="openMePage()" class="mt-1 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl active:scale-95 transition">Masuk Sekarang</button>' +
    '</div>';
    return;
  }

  gasGet_('getInfoData')
    .then(function(res) {
      homeDataCache.info = res;
      if (!res || !res.ok || !res.data.length) {
        el.innerHTML = '<div class="flex-shrink-0 w-64 rounded-2xl bg-gray-100 flex items-center justify-center h-28 snap-start"><p class="text-sm text-gray-400">Belum ada info</p></div>';
        return;
      }
      el.innerHTML = res.data.map(function(item, idx) {
        var meta = getKategoriMeta(item.kategori);
        return '<div class="flex-shrink-0 w-56 rounded-2xl snap-start cursor-pointer active:scale-[0.97] transition overflow-hidden border border-gray-100 shadow-sm" onclick="openInfoArtikel(' + idx + ')">' +
          '<div class="' + meta.bg + ' px-4 pt-3 pb-4 relative overflow-hidden">' +
            '<div class="absolute -right-4 -bottom-4 w-20 h-20 rounded-full bg-white/10"></div>' +
            '<div class="absolute right-3 top-2.5 text-xl opacity-90">' + meta.emoji + '</div>' +
            '<p class="text-[9px] uppercase tracking-widest text-white/70 font-bold">' + (item.kategori || 'Info') + '</p>' +
            '<p class="text-sm font-bold text-white mt-1 leading-snug pr-8">' + item.judul + '</p>' +
          '</div>' +
          '<div class="bg-white px-4 py-2.5 flex items-center justify-between">' +
            '<p class="text-[11px] text-gray-400">' + (item.tanggal || '') + '</p>' +
            '<svg class="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      document.getElementById('homeInfoCarousel').innerHTML =
        '<div class="flex-shrink-0 w-64 rounded-2xl bg-gray-100 flex items-center justify-center h-28 snap-start"><p class="text-sm text-red-400">Gagal memuat</p></div>';
    });
}

function formatInfoKonten(text) {
  if (!text) return '';

  // Split per baris
  var lines = text.split('\n');
  var result = [];
  var listItems = [];

  function flushList() {
    if (!listItems.length) return;
    var html = '<div class="space-y-2 my-3">';
    listItems.forEach(function(item, i) {
      html += '<div class="flex gap-3 items-start">' +
        '<div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">' +
          '<span class="text-[10px] font-bold text-primary">' + (i + 1) + '</span>' +
        '</div>' +
        '<p class="text-sm text-gray-700 leading-relaxed flex-1">' + item + '</p>' +
      '</div>';
    });
    html += '</div>';
    result.push(html);
    listItems = [];
  }

  lines.forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed) {
      flushList();
      result.push('<div class="h-3"></div>');
      return;
    }
    // Detect: "1. teks" atau "1) teks"
    // Strip invisible unicode chars setelah angka/titik sebelum match
    var cleaned = trimmed.replace(/[\u2060\u200B\u200C\u200D\uFEFF\u00A0]/g, ' ').trim();
    var match = cleaned.match(/^\d+[\.\)]\s*(.+)/);
    var bulletMatch = cleaned.match(/^[\*\-]\s+(.+)/);
    if (match) trimmed = cleaned;
    if (match) {
      listItems.push(match[1].trim());
    } else if (bulletMatch) {
      flushList();
      result.push(
        '<div class="flex gap-3 items-start my-1">' +
          '<div class="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">' +
            '<div class="w-1.5 h-1.5 rounded-full bg-primary"></div>' +
          '</div>' +
          '<p class="text-sm text-gray-700 leading-relaxed flex-1">' + bulletMatch[1].trim() + '</p>' +
        '</div>'
      );
    } else {
      flushList();
      result.push('<p class="text-sm text-gray-700 leading-relaxed">' + trimmed + '</p>');
    }
  });

  flushList();
  return result.join('');
}

function openInfoArtikel(idx) {
  const cache = homeDataCache.info;
  if (!cache || !cache.data || !cache.data[idx]) return;
  const item = cache.data[idx];
  document.getElementById('infoArtikelKategori').innerText = item.kategori || '';
  document.getElementById('infoArtikelJudul').innerText    = item.judul || '';
  document.getElementById('infoArtikelTanggal').innerText  = item.tanggal || '';
  document.getElementById('infoArtikelKonten').innerHTML = formatInfoKonten(item.konten || '');
  document.getElementById('infoArtikelModal').classList.remove('hidden');
}

function closeInfoArtikelModal() {
  document.getElementById('infoArtikelModal').classList.add('hidden');
}

// --- REKENING COPY ---
function copyRekening() {
  const noRek = '7305014010';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(noRek).then(function() {
      showCopySuccess();
    }).catch(function() { fallbackCopyRekening(noRek); });
  } else {
    fallbackCopyRekening(noRek);
  }
}

function fallbackCopyRekening(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); showCopySuccess(); } catch(e) {}
  document.body.removeChild(ta);
}

function showCopySuccess() {
  const icon = document.getElementById('copyRekeningIcon');
  if (icon) {
    icon.innerHTML = '<path d="M20 6L9 17l-5-5"/>';
    icon.classList.add('text-primary');
    icon.classList.remove('text-gray-500');
    setTimeout(function() {
      icon.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
      icon.classList.remove('text-primary');
      icon.classList.add('text-gray-500');
    }, 2000);
  }
  showToast('Nomor rekening disalin', 'success');
}

function openRekeningInfo() {
  var el = document.getElementById('rekeningInfoSection');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function() {
    el.classList.add('shake');
    setTimeout(function() {
      el.classList.remove('shake');
    }, 400);
  }, 500);
}

// ============================================================
// ADMIN BAYAR PICKER
// ============================================================

function openAdminBayarPicker() {
  var picker = document.getElementById('adminBayarPicker');
  if (!picker) return;

  // Set label blok admin
  var labelEl = document.getElementById('adminBayarBlokLabel');
  if (labelEl) {
    if (Array.isArray(currentUser.wargaData) && currentUser.wargaData.length) {
      labelEl.innerText = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
    } else {
      labelEl.innerText = 'Memuat...';
      gasGet_('getCurrentUserDataWarga', { email: currentUser.email })
        .then(function(res) {
          if (res && res.success) {
            currentUser.wargaData = res.data || [];
            labelEl.innerText = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
          }
        });
    }
  }

  picker.classList.remove('hidden');
}

function closeAdminBayarPicker() {
  var picker = document.getElementById('adminBayarPicker');
  if (picker) picker.classList.add('hidden');
}

function cancelAdminBayarPicker() {
  closeAdminBayarPicker();
  closeSheet();
}

function adminPilihSendiri() {
  closeAdminBayarPicker();

  // Reveal sheet DOM now (was deferred until after picker selection)
  document.body.classList.add('ipl-form-open');
  var _s = document.getElementById('sheet');
  var _o = document.getElementById('overlay');
  if (_s) { _s.scrollTop = 0; _s.classList.remove('translate-y-[120%]'); }
  if (_o) _o.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  var _ti = document.getElementById('tanggal');
  if (_ti && !_ti.value) _ti.value = formatDateISO(new Date());
  if (typeof _updateTanggalUI_ === 'function') _updateTanggalUI_();

  if (!Array.isArray(currentUser.wargaData) || !currentUser.wargaData.length) {
    showToast('Data warga belum siap, coba lagi', 'warning');
    return;
  }

  fillIdentityFromWargaData_();
  var identitySection = document.getElementById('identitySection');
  if (identitySection) identitySection.classList.add('hidden');

  // Treat admin pilih blok sendiri seperti warga:
  // load paid months & apply chip state + rate
  if (currentUser && currentUser.email) {
    if (wargaPaidMonths && wargaRateByMonth) {
      showDetailPaymentSkeleton_(true);
      // Hitung defaultRate dari rateByMonth jika cachedDefaultRate kosong
      var cachedRate = currentUser._cachedDefaultRate || 0;
      if (!cachedRate && wargaRateByMonth) {
        var nowYr = new Date().getFullYear();
        var rMap = wargaRateByMonth[nowYr] || {};
        var nowM = new Date().getMonth();
        for (var mi = nowM; mi < 12; mi++) {
          var rk = nowYr + '_' + mi;
          if (rMap[rk] && rMap[rk] > 0) { cachedRate = rMap[rk]; break; }
        }
        if (!cachedRate) {
          // ambil rate pertama yang ada
          var keys = Object.keys(rMap);
          if (keys.length) cachedRate = rMap[keys[0]] || 0;
        }
      }
      setTimeout(function() {
        applyPaidMonthsData_({
          ok: true,
          paid: wargaPaidMonths,
          pending: wargaPendingMonths || {},
          rateByMonth: wargaRateByMonth,
          defaultRate: cachedRate,
          bloks: window._wargaBloks_ || [],
          rateByBlokMonth: window._rateByBlokMonth_ || null
        });
        showDetailPaymentSkeleton_(false);
      }, 300);
    } else {
      showDetailPaymentSkeleton_(true);
      gasGet_('getWargaPaidMonths', { email: currentUser.email })
        .then(function(res) {
          showDetailPaymentSkeleton_(false);
          if (!res || !res.ok) return;
          wargaPaidMonths = res.paid;
          wargaRateByMonth = res.rateByMonth || null;
          if (currentUser) currentUser._cachedDefaultRate = res.defaultRate || 0;
          applyPaidMonthsData_(res);
        })
        .catch(function() {
          showDetailPaymentSkeleton_(false);
        });
    }
  }
}

function adminPilihWarga() {
  closeAdminBayarPicker();

  // Reveal sheet DOM now (was deferred until after picker selection)
  document.body.classList.add('ipl-form-open');
  var _s = document.getElementById('sheet');
  var _o = document.getElementById('overlay');
  if (_s) { _s.scrollTop = 0; _s.classList.remove('translate-y-[120%]'); }
  if (_o) _o.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  var _ti = document.getElementById('tanggal');
  if (_ti && !_ti.value) _ti.value = formatDateISO(new Date());
  if (typeof _updateTanggalUI_ === 'function') _updateTanggalUI_();

  // Reset semua identity fields — pastikan tidak ada sisa lock dari fillIdentityFromWargaData_
  var blokEl  = document.getElementById('blok');
  var namaEl  = document.getElementById('nama');
  var emailEl = document.getElementById('email');
  var hpEl    = document.getElementById('noHp');

  // Clear values
  [blokEl, namaEl, emailEl, hpEl].forEach(function(el) {
    if (!el) return;
    el.value = '';
    el.readOnly = false;
    el.classList.remove('bg-gray-100', 'cursor-not-allowed');
    delete el.dataset.autofilled;
    el.classList.remove('autofilled');
  });

  // Reset blok khusus — harus bisa diketik
  if (blokEl) {
    blokEl.readOnly = false;
    blokEl.classList.remove('bg-gray-100', 'cursor-not-allowed');
  }

  // Sembunyikan summary card (dari fillIdentityFromWargaData_)
  var summaryCard = document.getElementById('identitySummaryCard');
  if (summaryCard) summaryCard.classList.add('hidden');

  // Reset lookup state
  isLookupLocked = false;
  multiDecisionMode = null;
  residentSuggestion = null;

  // Sembunyikan suggestion box
  var suggBox = document.getElementById('blokSuggestion');
  if (suggBox) suggBox.classList.add('hidden');

  // Tampilkan identitySection
  var identitySection = document.getElementById('identitySection');
  if (identitySection) identitySection.classList.remove('hidden');

  // Focus ke blok input
  setTimeout(function() {
    if (blokEl) blokEl.focus();
  }, 100);
}

function fillIdentityFromWargaData_() {
  var blokEl  = document.getElementById('blok');
  var namaEl  = document.getElementById('nama');
  var emailEl = document.getElementById('email');
  var hpEl    = document.getElementById('noHp');

  var first = currentUser.wargaData[0];

  if (blokEl) blokEl.value = currentUser.wargaData.map(function(d) { return d.blok; }).join(', ');
  if (namaEl)  namaEl.value  = first.nama  || '';
  if (emailEl) emailEl.value = first.email || currentUser.email || '';
  if (hpEl)    hpEl.value    = first.noHp  || '';

  lockIdentityFields();
  isLookupLocked = true;

  if (blokEl) {
    blokEl.readOnly = true;
    blokEl.classList.add('bg-gray-100', 'cursor-not-allowed');
  }

  // Tampilkan summary card, sembunyikan identitySection
  var summaryCard = document.getElementById('identitySummaryCard');
  var summaryName = document.getElementById('identitySummaryName');
  var summaryBlok = document.getElementById('identitySummaryBlok');
  var identitySection = document.getElementById('identitySection');

  if (summaryCard && currentUser) {
    if (summaryName) summaryName.innerText = first.nama || currentUser.fullName || '';
    if (summaryBlok) summaryBlok.innerText = 'Blok ' + currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    summaryCard.classList.remove('hidden');
  }

  if (identitySection) identitySection.classList.add('hidden');
}

// ============================================================
// CONTACT CENTER
// ============================================================

function openContactModal() {
  var modal = document.getElementById('contactModal');
  var listEl = document.getElementById('contactList');
  if (!modal || !listEl) return;

  modal.classList.remove('hidden');

  // Gunakan cache jika sudah ada
  if (homeDataCache.contact) {
    renderContactList(homeDataCache.contact, listEl);
    return;
  }

  listEl.innerHTML = '<div class="h-16 rounded-2xl bg-gray-100 animate-pulse"></div>';

  // AMBIL DATA SELAIN SECURITY
  gasGet_('getNonSecurityContacts')
    .then(function(res) {
      homeDataCache.contact = res;
      renderContactList(res, listEl);
    })
    .catch(function() {
      listEl.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Gagal memuat kontak</p>';
    });
}

function closeContactModal() {
  var modal = document.getElementById('contactModal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================
// SECURITY FLOATING BUTTON
// ============================================================

function toggleSecurityModal() {
  var overlay = document.getElementById('securityOverlay');
  if (!overlay) return;

  if (overlay.classList.contains('hidden')) {
    // Open modal
    overlay.classList.remove('hidden');

    // Load security contacts
    loadSecurityContacts();
  } else {
    // Close modal
    overlay.classList.add('hidden');
  }
}

function loadSecurityContacts() {
  var listEl = document.getElementById('securityContactList');
  if (!listEl) return;

  // Gunakan cache jika sudah ada
  if (homeDataCache.security) {
    renderSecurityContactList(homeDataCache.security, listEl);
    return;
  }

  listEl.innerHTML = '<div class="h-16 rounded-2xl bg-gray-100 animate-pulse"></div>';

  // Load data from backend
  gasGet_('getSecurityContacts')
    .then(function(res) {
      homeDataCache.security = res;
      renderSecurityContactList(res, listEl);
    })
    .catch(function() {
      listEl.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Gagal memuat kontak security</p>';
    });
}

function renderSecurityContactList(res, listEl) {
  if (!listEl) return;
  if (!res || !res.ok || !res.data.length) {
    listEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Belum ada kontak security tersedia</p>';
    return;
  }
  var allData = res.data;
  function buildSecurityHTML(data) {
    return data.map(function(c) {
      var hp = String(c.noHp || '').replace(/\D/g, '');
      var waHp = hp.startsWith('0') ? '62' + hp.slice(1) : hp;
      return '<div class="contact-item flex items-center justify-between py-2.5 border-b border-gray-50">' +
        '<div>' +
          '<p class="text-sm font-semibold text-gray-900">' + c.nama + '</p>' +
          '<p class="text-xs text-gray-400">' + c.jabatan + '</p>' +
        '</div>' +
        '<div class="flex gap-1.5">' +
          '<a href="tel:+' + hp + '" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>' +
            '</svg>' +
          '</a>' +
          '<a href="https://wa.me/' + waHp + '" target="_blank" class="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
            '</svg>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  listEl.innerHTML = buildSecurityHTML(allData);

  var searchEl = document.getElementById('securitySearch');
  if (searchEl) {
    searchEl.oninput = function() {
      var q = this.value.toLowerCase();
      var filtered = allData.filter(function(c) {
        return (c.nama + c.jabatan).toLowerCase().indexOf(q) !== -1;
      });
      listEl.innerHTML = filtered.length
        ? buildSecurityHTML(filtered)
        : '<p class="text-xs text-gray-400 text-center py-3">Tidak ditemukan</p>';
    };
  }
}

function renderContactList(res, listEl) {
  if (!listEl) return;
  if (!res || !res.ok || !res.data.length) {
    listEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Belum ada kontak tersedia</p>';
    return;
  }
  var allData = res.data;
  function buildContactHTML(data) {
    return data.map(function(c) {
      var hp = String(c.noHp || '').replace(/\D/g, '').replace(/^0/, '62');
      return '<div class="contact-item flex items-center justify-between py-2.5 border-b border-gray-50">' +
        '<div>' +
          '<p class="text-sm font-semibold text-gray-900">' + c.nama + '</p>' +
          '<p class="text-xs text-gray-400">' + c.jabatan + '</p>' +
        '</div>' +
        '<div class="flex gap-1.5">' +
          '<a href="tel:+' + hp + '" class="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
              '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>' +
            '</svg>' +
          '</a>' +
          '<a href="https://wa.me/' + hp + '" target="_blank" class="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center active:scale-95 transition">' +
            '<svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">' +
              '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>' +
            '</svg>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  listEl.innerHTML = buildContactHTML(allData);

  var searchEl = document.getElementById('contactSearch');
  if (searchEl) {
    searchEl.oninput = function() {
      var q = this.value.toLowerCase();
      var filtered = allData.filter(function(c) {
        return (c.nama + c.jabatan).toLowerCase().indexOf(q) !== -1;
      });
      listEl.innerHTML = filtered.length
        ? buildContactHTML(filtered)
        : '<p class="text-xs text-gray-400 text-center py-3">Tidak ditemukan</p>';
    };
  }
}

function backToEmailStep() {
  // Hide ALL steps first, then show email step
  ['sayaStepOTP','sayaStepMethod','sayaStepResetPIN'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.style.display = ''; }
  });
  var emailStep = document.getElementById('sayaStepEmail');
  if (emailStep) {
    emailStep.classList.remove('hidden');
    emailStep.classList.add('saya-step');
    setTimeout(function() { emailStep.classList.remove('saya-step'); }, 300);
  }
}

// Alias used by login-prompt buttons in Info Cluster, Fasum, Pedoman, etc.
function openMePage() { openPageSaya(); }

function closePageSaya() {
  document.body.classList.remove('saya-open');
  var namaInput  = document.getElementById('sayaNamaInput');
  var hpInput    = document.getElementById('sayaHpInput');
  var emailInput = document.getElementById('sayaEmailEditInput');
  var editBtn    = document.getElementById('sayaEditBtn');
  var saveBtn    = document.getElementById('sayaSaveBtn');

  [namaInput, hpInput].forEach(function(el) {
    if (!el) return;
    el.readOnly = true;
    el.style.borderBottom = '';
    el.style.paddingBottom = '';
  });

  if (editBtn) editBtn.classList.remove('hidden');
  if (saveBtn) saveBtn.classList.add('hidden');

  switchPage('homePage');
  setActiveNavById('navHome');
}

function showEmailHint_() {
    var existing = document.getElementById('emailHintBubble');
    if (existing) return;

    var bubble = document.createElement('div');
    bubble.id = 'emailHintBubble';
    bubble.style.cssText = [
      'position:fixed',
      'bottom:100px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1f2937',
      'color:#fff',
      'font-size:13px',
      'font-weight:500',
      'padding:10px 18px',
      'border-radius:12px',
      'white-space:nowrap',
      'z-index:99999',
      'opacity:0',
      'transition:opacity 0.2s ease',
      'pointer-events:none'
    ].join(';');
    bubble.innerText = 'Untuk mengubah email, hubungi Pengurus';

    document.body.appendChild(bubble);

    requestAnimationFrame(function() {
      bubble.style.opacity = '1';
    });

    setTimeout(function() {
      bubble.style.opacity = '0';
      setTimeout(function() {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      }, 200);
    }, 2500);
  }

function openSayaFromSheet_() {
    // Tutup sheet dulu tanpa reset cache
    document.body.classList.remove('ipl-form-open');
    var overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';

    // Buka page Saya
    setTimeout(function() {
      openPageSaya();
    }, 50);
  }

function openAboutModal() {
  document.getElementById('aboutModal').classList.remove('hidden');
}

function closeAboutModal() {
  document.getElementById('aboutModal').classList.add('hidden');
}

/* ============================================================
   EXPLORE PAGE
   ============================================================ */
function openExplore() { openAdminPage(); } // legacy alias

function openAdminPage() {
  if (!currentUser || currentUser.role !== 'admin') return;
  switchPage('explorePage');
  setActiveNavById('navAdmin');
  refreshAdminExploreSection();
  if (!history.state || !history.state.explore) {
    history.pushState({ explore: true }, '');
  }
  var exploreScroll = document.querySelector('#explorePage .flex-1.overflow-y-auto');
  if (exploreScroll) exploreScroll.scrollTop = 0;
}

/* ============================================================
   ADMIN CRUD — INFO & FASUM
   ============================================================ */

var _infoCRUDCache       = null;
var _fasumCRUDCache      = null;
var _adminLaporCache_    = null;
var _adminWargaBaruCache_ = null;

// ===== SHOW/HIDE navAdmin BASED ON ROLE =====
function updateNavAdminVisibility() {
  var btn = document.getElementById('navAdmin');
  if (!btn) return;
  var isAdmin = currentUser && currentUser.role === 'admin';
  if (isAdmin) {
    btn.classList.remove('hidden');
    btn.classList.add('flex');
  } else {
    btn.classList.add('hidden');
    btn.classList.remove('flex');
  }
}

// ===== SHOW/HIDE ADMIN SECTION =====
function refreshAdminExploreSection(forceRefresh) {
  var sec = document.getElementById('adminExploreSection');
  if (!sec) return;
  if (currentUser && currentUser.role === 'admin') {
    sec.classList.remove('hidden');
    if (forceRefresh) {
      _infoCRUDCache       = null;
      _fasumCRUDCache      = null;
      _greetingCRUDCache   = null;
      _dataWargaCache      = null;
      _adminLaporCache_    = null;
      _adminWargaBaruCache_ = null;
      _ssClearExplore_();
    }
    loadAdminInfoPreview();
    loadAdminFasumPreview();
    loadAdminGreetingPreview();
    loadAdminWargaPreview();
    loadAdminWargaBaruPreview();
    loadAdminLaporPreview();
  } else {
    sec.classList.add('hidden');
  }
}

var _EXPLORE_CACHE_TTL = 5 * 60 * 1000; // 5 menit

function _ssGetExplore_(key) {
  try {
    var raw = sessionStorage.getItem(key);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (Date.now() - (p._ts || 0) > _EXPLORE_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return p;
  } catch(e) { return null; }
}
function _ssSetExplore_(key, data) {
  try { data._ts = Date.now(); sessionStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
}
function _ssClearExplore_() {
  try {
    ['exploreInfoCache','exploreFasumCache','exploreLaporCache','exploreWargaBaruCache'].forEach(function(k) {
      sessionStorage.removeItem(k);
    });
  } catch(e) {}
}

function loadAdminInfoPreview() {
  var el = document.getElementById('adminInfoPreviewList');
  if (!el) return;
  if (_infoCRUDCache) { renderAdminInfoPreview_(_infoCRUDCache); return; }
  // Try sessionStorage
  var cached = _ssGetExplore_('exploreInfoCache');
  if (cached) { _infoCRUDCache = cached; renderAdminInfoPreview_(cached); return; }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetInfoData')
    .then(function(res) { _infoCRUDCache = res; _ssSetExplore_('exploreInfoCache', res); renderAdminInfoPreview_(res); })
    .catch(function() {});
}

function renderAdminInfoPreview_(res) {
  var el = document.getElementById('adminInfoPreviewList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1">Belum ada info.</p>';
    return;
  }
  el.innerHTML = res.data.slice(0, 3).map(function(d) {
    return '<div class="flex items-center justify-between py-1.5">' +
      '<span class="text-xs text-gray-700 truncate flex-1 pr-2">' + d.judul + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full ' + (d.aktif ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400') + ' font-medium flex-shrink-0">' +
      (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
    '</div>';
  }).join('') + (res.data.length > 3 ? '<p class="text-xs text-gray-400 pt-1">+' + (res.data.length - 3) + ' lainnya</p>' : '');
}

function renderAdminFasumPreview_(res) {
  var el = document.getElementById('adminFasumPreviewList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1">Belum ada fasum.</p>';
    return;
  }
  // Update scorecard
  var issues = res.data.filter(function(d) { return d.status.toLowerCase() !== 'normal'; }).length;
  var scIssue = document.getElementById('scAdminFasumIssue');
  var scTotal = document.getElementById('scAdminFasumTotal');
  if (scIssue) scIssue.textContent = issues;
  if (scTotal) scTotal.textContent = '/ ' + res.data.length;
  var STATUS_COLOR = { normal: 'bg-green-50 text-green-600', maintenance: 'bg-yellow-50 text-yellow-600' };
  el.innerHTML = res.data.slice(0, 3).map(function(d) {
    var color = STATUS_COLOR[d.status.toLowerCase()] || 'bg-red-50 text-red-500';
    return '<div class="flex items-center justify-between py-1">' +
      '<span class="text-xs text-gray-700 truncate flex-1 pr-2">' + d.nama + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full ' + color + ' font-medium flex-shrink-0">' + d.status + '</span>' +
    '</div>';
  }).join('') + (res.data.length > 3 ? '<p class="text-[10px] text-gray-400 pt-1">+' + (res.data.length - 3) + ' lainnya</p>' : '');
}

function loadAdminFasumPreview() {
  var el = document.getElementById('adminFasumPreviewList');
  if (!el) return;
  if (_fasumCRUDCache) { renderAdminFasumPreview_(_fasumCRUDCache); return; }
  // Try sessionStorage
  var cached = _ssGetExplore_('exploreFasumCache');
  if (cached) { _fasumCRUDCache = cached; renderAdminFasumPreview_(cached); return; }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetFasumData')
    .then(function(res) { _fasumCRUDCache = res; _ssSetExplore_('exploreFasumCache', res); renderAdminFasumPreview_(res); })
    .catch(function() {});
}

// ===== INFO CRUD =====
function openInfoCRUD() {
  var modal = document.getElementById('infoCRUDModal');
  modal.classList.remove('hidden');
  renderInfoCRUDList(_infoCRUDCache);
  if (!_infoCRUDCache) {
    gasGet_('adminGetInfoData')
      .then(function(res) { _infoCRUDCache = res; renderInfoCRUDList(res); })
      .catch(function() {});
  }
}

function closeInfoCRUD() {
  document.getElementById('infoCRUDModal').classList.add('hidden');
}

var _infoDataMap = {};
var _fasumDataMap = {};

function renderInfoCRUDList(res) {
  var el = document.getElementById('infoCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada info. Tap + Tambah untuk mulai.</p>';
    return;
  }
  _infoDataMap = {};
  res.data.forEach(function(d) { _infoDataMap[d.rowNumber] = d; });

  el.innerHTML = res.data.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-0.5">' +
          '<span class="text-sm font-semibold text-gray-900 truncate">' + d.judul + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-green-50 text-green-600' : 'bg-gray-200 text-gray-400') + ' font-medium">' + (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + d.kategori + ' · ' + (d.tanggal || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openInfoFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteInfoConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openInfoFormByRow(rowNumber) {
  var d = _infoDataMap[rowNumber];
  if (!d) return;
  openInfoForm(d);
}

function openFasumFormByRow(rowNumber) {
  var d = _fasumDataMap[rowNumber];
  if (!d) return;
  openFasumForm(d);
}

// Ganti confirm() dengan modal — confirm() diblokir di GAS sandbox
var _pendingDeleteFn = null;

function showDeleteConfirm(message, onConfirm) {
  var modal = document.getElementById('deleteConfirmModal');
  var msgEl = document.getElementById('deleteConfirmMsg');
  if (!modal || !msgEl) {
    // fallback jika modal belum ada
    onConfirm();
    return;
  }
  msgEl.innerText = message;
  _pendingDeleteFn = onConfirm;
  modal.classList.remove('hidden');
}

function closeDeleteConfirm() {
  var modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.classList.add('hidden');
  _pendingDeleteFn = null;

  // Reset tombol ke state awal
  var hapusBtn = document.querySelector('#deleteConfirmModal button:last-child');
  var batalBtn = document.querySelector('#deleteConfirmModal button:first-child');
  if (hapusBtn) {
    hapusBtn.disabled = false;
    hapusBtn.innerHTML = 'Hapus';
  }
  if (batalBtn) batalBtn.disabled = false;
}

function confirmDeleteAction() {
  var fn = _pendingDeleteFn;
  if (typeof fn !== 'function') return;

  // Spinner di modal
  var hapusBtn = document.querySelector('#deleteConfirmModal button:last-child');
  var batalBtn = document.querySelector('#deleteConfirmModal button:first-child');
  if (hapusBtn) {
    hapusBtn.disabled = true;
    hapusBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
      '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10"/>' +
      '</svg>Menghapus...</span>';
  }
  if (batalBtn) batalBtn.disabled = true;

  _pendingDeleteFn = null;
  fn();
}

function deleteInfoConfirm(rowNumber) {
  showDeleteConfirm('Hapus info ini?', function() { deleteInfo(rowNumber); });
}

function deleteFasumConfirm(rowNumber) {
  showDeleteConfirm('Hapus fasum ini?', function() { deleteFasum(rowNumber); });
}

function openInfoForm(data) {
  document.getElementById('infoFormModal').classList.remove('hidden');
  document.getElementById('infoFormTitle').innerText = data ? 'Edit Info' : 'Tambah Info';
  document.getElementById('infoFormRow').value = data ? data.rowNumber : '';
  document.getElementById('infoFormJudul').value = data ? data.judul : '';
  document.getElementById('infoFormKonten').value = data ? data.konten : '';
  document.getElementById('infoFormKategori').value = data ? data.kategori : 'Pengumuman';
  document.getElementById('infoFormTanggal').value = data ? data.tanggal : new Date().toISOString().split('T')[0];
  document.getElementById('infoFormAktif').checked = data ? data.aktif : true;
}

function closeInfoForm() {
  document.getElementById('infoFormModal').classList.add('hidden');
}

function saveInfoForm() {
  var btn = document.getElementById('infoFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var payload = {
    rowNumber: parseInt(document.getElementById('infoFormRow').value) || null,
    judul    : document.getElementById('infoFormJudul').value.trim(),
    konten   : document.getElementById('infoFormKonten').value.trim(),
    kategori : document.getElementById('infoFormKategori').value,
    tanggal  : document.getElementById('infoFormTanggal').value,
    aktif    : document.getElementById('infoFormAktif').checked
  };
  gasPost_('adminSaveInfo', { payload: payload })
    .then(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      closeInfoForm();
      _infoCRUDCache = null;
      sessionStorage.removeItem('exploreInfoCache');
      gasGet_('adminGetInfoData')
        .then(function(res) {
          _infoCRUDCache = res;
          _ssSetExplore_('exploreInfoCache', res);
          renderInfoCRUDList(res);
          loadAdminInfoPreview();
          homeDataCache.info = null;
        });
      showToast('Info berhasil disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteInfo(rowNumber) {
  gasPost_('adminDeleteInfo', { rowNumber: rowNumber })
      .then(function(res) {
        if (!res || !res.ok) { showToast('Gagal menghapus info', 'error'); return; }
        closeDeleteConfirm();
        showToast('Info dihapus', 'success');
        _infoCRUDCache = null;
        homeDataCache.info = null;
        sessionStorage.removeItem('exploreInfoCache');
        gasGet_('adminGetInfoData')
          .then(function(res2) {
            _infoCRUDCache = res2;
            _ssSetExplore_('exploreInfoCache', res2);
            renderInfoCRUDList(res2);
            loadAdminInfoPreview();
          });
      })
      .catch(function() {
        closeDeleteConfirm();
        showToast('Gagal menghapus ...', 'error');
      });
}

// ===== FASUM CRUD =====
function openFasumCRUD() {
  var modal = document.getElementById('fasumCRUDModal');
  modal.classList.remove('hidden');
  renderFasumCRUDList(_fasumCRUDCache);
  if (!_fasumCRUDCache) {
    gasGet_('adminGetFasumData')
      .then(function(res) { _fasumCRUDCache = res; renderFasumCRUDList(res); })
      .catch(function() {});
  }
}

function closeFasumCRUD() {
  document.getElementById('fasumCRUDModal').classList.add('hidden');
}

function renderFasumCRUDList(res) {
  var el = document.getElementById('fasumCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada fasum.</p>';
    return;
  }
  _fasumDataMap = {};
  res.data.forEach(function(d) { _fasumDataMap[d.rowNumber] = d; });

  var STATUS_COLOR = {
    'normal'     : 'bg-green-50 text-green-600',
    'maintenance': 'bg-yellow-50 text-yellow-600'
  };
  el.innerHTML = res.data.map(function(d) {
    var color = STATUS_COLOR[d.status.toLowerCase()] || 'bg-red-50 text-red-500';
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm font-semibold text-gray-900">' + d.nama + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + color + ' font-medium">' + d.status + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + (d.deskripsi || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openFasumFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteFasumConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openFasumForm(data) {
  document.getElementById('fasumFormModal').classList.remove('hidden');
  document.getElementById('fasumFormTitle').innerText = data ? 'Edit Fasum' : 'Tambah Fasum';
  document.getElementById('fasumFormRow').value = data ? data.rowNumber : '';
  document.getElementById('fasumFormNama').value = data ? data.nama : '';
  document.getElementById('fasumFormDeskripsi').value = data ? data.deskripsi : '';
  document.getElementById('fasumFormStatus').value = data ? data.status : 'Normal';
  document.getElementById('fasumFormIcon').value = data ? data.icon : 'gate';
}

function closeFasumForm() {
  document.getElementById('fasumFormModal').classList.add('hidden');
}

function saveFasumForm() {
  var btn = document.getElementById('fasumFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var rowNumber = parseInt(document.getElementById('fasumFormRow').value) || null;
  var payload = {
    rowNumber : rowNumber,
    nama      : document.getElementById('fasumFormNama').value.trim(),
    deskripsi : document.getElementById('fasumFormDeskripsi').value.trim(),
    status    : document.getElementById('fasumFormStatus').value,
    icon      : document.getElementById('fasumFormIcon').value
  };
  var gasAction = rowNumber ? 'adminSaveFasum' : 'adminAddFasum';
    gasPost_(gasAction, { payload: payload })
      .then(function() {
        btn.disabled = false;
        btn.innerText = 'Simpan';
        closeFasumForm();
        _fasumCRUDCache = null;
        sessionStorage.removeItem('exploreFasumCache');
        gasGet_('adminGetFasumData')
          .then(function(res) {
            _fasumCRUDCache = res;
            _ssSetExplore_('exploreFasumCache', res);
            renderFasumCRUDList(res);
            loadAdminFasumPreview();
            homeDataCache.fasum = null;
            loadHomeFasum();
          });
        showToast('Fasum berhasil disimpan', 'success');
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerText = 'Simpan';
        showToast('Gagal menyimpan', 'error');
      });
  }

function deleteFasum(rowNumber) {
  gasPost_('adminDeleteFasum', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus fasum', 'error'); return; }
      closeDeleteConfirm();
      showToast('Fasum dihapus', 'success');
      _fasumCRUDCache = null;
      homeDataCache.fasum = null;
      sessionStorage.removeItem('exploreFasumCache');
      gasGet_('adminGetFasumData')
        .then(function(res2) {
          _fasumCRUDCache = res2;
          _ssSetExplore_('exploreFasumCache', res2);
          renderFasumCRUDList(res2);
          loadAdminFasumPreview();
          loadHomeFasum();
        });
    })
    .catch(function() {
      closeDeleteConfirm();
      showToast('Gagal menghapus ...', 'error');
    });
}

/* ============================================================
   ADMIN CRUD: DATA WARGA
   ============================================================ */
var _dataWargaCache = null;
var _dataWargaMap   = {};
var _dataWargaFiltered = [];

function openDataWargaCRUD() {
  var modal = document.getElementById('dataWargaCRUDModal');
  modal.classList.remove('hidden');
  var searchEl = document.getElementById('dataWargaSearch');
  if (searchEl) searchEl.value = '';
  if (_dataWargaCache) {
    renderDataWargaList(_dataWargaCache);
  } else {
    _showDataWargaLoading_();
    gasGet_('adminGetDataWarga')
      .then(function(res) { _dataWargaCache = res; renderDataWargaList(res); })
      .catch(function() {
        var el = document.getElementById('dataWargaCRUDList');
        if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data. Coba lagi.</p>';
      });
  }
}

function _showDataWargaLoading_() {
  var el = document.getElementById('dataWargaCRUDList');
  if (!el) return;
  el.innerHTML = '<div class="flex flex-col items-center justify-center py-10 gap-3">' +
    '<svg class="w-7 h-7 text-primary animate-spin" fill="none" viewBox="0 0 24 24">' +
      '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
      '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>' +
    '</svg>' +
    '<p class="text-xs text-gray-400">Memuat data warga...</p>' +
  '</div>';
}

function closeDataWargaCRUD() {
  document.getElementById('dataWargaCRUDModal').classList.add('hidden');
}

function renderDataWargaList(res, filtered) {
  var el = document.getElementById('dataWargaCRUDList');
  if (!el) return;
  var list = filtered || (res && res.data) || [];
  if (!res || !res.ok) {
    el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data.</p>';
    return;
  }
  if (!list.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Tidak ada data warga.</p>';
    return;
  }
  _dataWargaMap = {};
  (res.data || []).forEach(function(d) { _dataWargaMap[d.rowNumber] = d; });
  el.innerHTML = list.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3">' +
      '<div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-black text-sm" style="background:' + _avatarColors_[d.blok.charCodeAt(0) % _avatarColors_.length] + '">' +
        d.blok.charAt(0) +
      '</div>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-bold text-gray-900 truncate">' + d.blok + ' · ' + (d.nama || '—') + '</p>' +
        '<p class="text-[11px] text-gray-400 truncate">' + (d.email || '—') + '</p>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openDataWargaFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteDataWargaConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filterDataWargaList() {
  var kw = (document.getElementById('dataWargaSearch')?.value || '').toLowerCase().trim();
  if (!_dataWargaCache || !_dataWargaCache.data) return;
  var filtered = kw
    ? _dataWargaCache.data.filter(function(d) {
        return (d.blok + ' ' + d.nama + ' ' + d.email).toLowerCase().indexOf(kw) !== -1;
      })
    : _dataWargaCache.data;
  renderDataWargaList(_dataWargaCache, filtered);
}

function openDataWargaFormByRow(rowNumber) {
  var d = _dataWargaMap[rowNumber];
  if (!d) return;
  openDataWargaForm(d);
}

function openDataWargaForm(data) {
  document.getElementById('dataWargaFormModal').classList.remove('hidden');
  document.getElementById('dataWargaFormTitle').innerText = data ? 'Edit Warga' : 'Tambah Warga';
  document.getElementById('dataWargaFormRow').value   = data ? data.rowNumber : '';
  document.getElementById('dataWargaFormBlok').value  = data ? data.blok  : '';
  document.getElementById('dataWargaFormNama').value  = data ? data.nama  : '';
  document.getElementById('dataWargaFormHp').value    = data ? data.noHp  : '';
  document.getElementById('dataWargaFormEmail').value = data ? data.email : '';
}

function closeDataWargaForm() {
  document.getElementById('dataWargaFormModal').classList.add('hidden');
}

function saveDataWargaForm() {
  var blok = document.getElementById('dataWargaFormBlok').value.trim().toUpperCase();
  var nama = document.getElementById('dataWargaFormNama').value.trim();
  if (!blok || !nama) { showToast('Blok dan Nama wajib diisi', 'error'); return; }

  var btn = document.getElementById('dataWargaFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';

  var payload = {
    rowNumber : parseInt(document.getElementById('dataWargaFormRow').value) || null,
    blok  : blok,
    nama  : nama,
    noHp  : document.getElementById('dataWargaFormHp').value.trim(),
    email : document.getElementById('dataWargaFormEmail').value.trim().toLowerCase()
  };

  gasPost_('adminSaveDataWarga', { payload: payload })
    .then(function() {
      btn.disabled = false; btn.innerText = 'Simpan';
      closeDataWargaForm();
      _dataWargaCache = null;
      gasGet_('adminGetDataWarga').then(function(res) {
        _dataWargaCache = res;
        renderDataWargaList(res);
        loadAdminWargaPreview();
      });
      showToast('Data warga disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false; btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteDataWargaConfirm(rowNumber) {
  var d = _dataWargaMap[rowNumber];
  var label = d ? (d.blok + ' · ' + d.nama) : 'warga ini';
  showDeleteConfirm('Hapus ' + label + '?', function() { deleteDataWarga(rowNumber); });
}

function deleteDataWarga(rowNumber) {
  gasPost_('adminDeleteDataWarga', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus', 'error'); return; }
      closeDeleteConfirm();
      showToast('Data warga dihapus', 'success');
      _dataWargaCache = null;
      gasGet_('adminGetDataWarga').then(function(res2) {
        _dataWargaCache = res2;
        renderDataWargaList(res2);
        loadAdminWargaPreview();
      });
    })
    .catch(function() { closeDeleteConfirm(); showToast('Gagal menghapus', 'error'); });
}

function loadAdminWargaPreview() {
  var el = document.getElementById('adminWargaPreviewList');
  if (!el) return;
  gasGet_('adminGetDataWarga').then(function(res) {
    if (!res || !res.ok || !res.data || !res.data.length) {
      el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada data</p>';
      return;
    }
    var total = res.data.length;
    // Update scorecard
    var sc = document.getElementById('scAdminWarga');
    if (sc) sc.textContent = total;
    // Group by first letter of blok (A/B/C/D)
    var groups = {};
    res.data.forEach(function(d) { var k = d.blok.charAt(0); groups[k] = (groups[k]||0)+1; });
    var groupStr = Object.keys(groups).sort().map(function(k){ return 'Blok '+k+' ('+groups[k]+')'; }).join(' · ');
    el.innerHTML = '<p class="text-xs text-gray-500 font-medium">' + total + ' warga terdaftar</p>' +
      '<p class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">' + groupStr + '</p>';
  }).catch(function() {
    el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
  });
}

/* ============================================================
   ADMIN CRUD: GREETING
   ============================================================ */
var _greetingCRUDCache = null;
var _greetingDataMap = {};

function openGreetingCRUD() {
  var modal = document.getElementById('greetingCRUDModal');
  modal.classList.remove('hidden');
  if (_greetingCRUDCache) {
    renderGreetingCRUDList(_greetingCRUDCache);
  } else {
    var el = document.getElementById('greetingCRUDList');
    if (el) el.innerHTML = '<div class="flex flex-col items-center justify-center py-10 gap-3">' +
      '<svg class="w-7 h-7 text-primary animate-spin" fill="none" viewBox="0 0 24 24">' +
        '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
        '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>' +
      '</svg>' +
      '<p class="text-xs text-gray-400">Memuat greeting...</p>' +
    '</div>';
    gasGet_('adminGetGreetings')
      .then(function(res) { _greetingCRUDCache = res; renderGreetingCRUDList(res); })
      .catch(function() {
        if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat. Coba lagi.</p>';
      });
  }
}

function closeGreetingCRUD() {
  document.getElementById('greetingCRUDModal').classList.add('hidden');
}

function renderGreetingCRUDList(res) {
  var el = document.getElementById('greetingCRUDList');
  if (!el) return;
  if (!res || !res.ok || !res.data || !res.data.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Belum ada greeting. Tap + Tambah untuk mulai.</p>';
    return;
  }
  _greetingDataMap = {};
  res.data.forEach(function(d) { _greetingDataMap[d.rowNumber] = d; });
  el.innerHTML = res.data.map(function(d) {
    return '<div class="bg-gray-50 rounded-2xl px-4 py-3 flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-0.5">' +
          '<span class="text-sm font-semibold text-gray-900 truncate">' + (d.judul || d.teks || '') + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-green-50 text-green-600' : 'bg-gray-200 text-gray-400') + ' font-medium">' + (d.aktif ? 'Aktif' : 'Nonaktif') + '</span>' +
        '</div>' +
        '<span class="text-[11px] text-gray-400">' + (d.mulai || '') + ' → ' + (d.stop || '') + '</span>' +
      '</div>' +
      '<div class="flex gap-1.5 flex-shrink-0">' +
        '<button onclick="openGreetingFormByRow(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button onclick="deleteGreetingConfirm(' + d.rowNumber + ')" class="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center active:scale-95 transition">' +
          '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openGreetingFormByRow(rowNumber) {
  var d = _greetingDataMap[rowNumber];
  if (!d) return;
  openGreetingForm(d);
}

function openGreetingForm(data) {
  document.getElementById('greetingFormModal').classList.remove('hidden');
  document.getElementById('greetingFormTitle').innerText = data ? 'Edit Greeting' : 'Tambah Greeting';
  document.getElementById('greetingFormRow').value   = data ? data.rowNumber : '';
  document.getElementById('greetingFormJudul').value  = data ? (data.judul || '') : '';
  document.getElementById('greetingFormTeks').value   = data ? (data.konten || data.teks || '') : '';
  document.getElementById('greetingFormMulai').value  = data ? data.mulai : new Date().toISOString().split('T')[0];
  document.getElementById('greetingFormStop').value   = data ? data.stop  : new Date().toISOString().split('T')[0];
  document.getElementById('greetingFormAktif').checked = data ? data.aktif : true;
}

function closeGreetingForm() {
  document.getElementById('greetingFormModal').classList.add('hidden');
}

function saveGreetingForm() {
  var btn = document.getElementById('greetingFormSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<svg style="width:16px;height:16px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>' +
    '<path d="M12 2a10 10 0 0 1 10 10"/>' +
    '</svg>Menyimpan...</span>';
  var payload = {
    rowNumber : parseInt(document.getElementById('greetingFormRow').value) || null,
    judul     : document.getElementById('greetingFormJudul').value.trim(),
    konten    : document.getElementById('greetingFormTeks').value.trim(),
    mulai     : document.getElementById('greetingFormMulai').value,
    stop      : document.getElementById('greetingFormStop').value,
    aktif     : document.getElementById('greetingFormAktif').checked
  };
  gasPost_('adminSaveGreeting', { payload: payload })
    .then(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      closeGreetingForm();
      _greetingCRUDCache = null;
      gasGet_('adminGetGreetings')
        .then(function(res) {
          _greetingCRUDCache = res;
          renderGreetingCRUDList(res);
          loadAdminGreetingPreview();
        });
      showToast('Greeting berhasil disimpan', 'success');
    })
    .catch(function() {
      btn.disabled = false;
      btn.innerText = 'Simpan';
      showToast('Gagal menyimpan', 'error');
    });
}

function deleteGreetingConfirm(rowNumber) {
  showDeleteConfirm('Hapus greeting ini?', function() { deleteGreeting(rowNumber); });
}

function deleteGreeting(rowNumber) {
  gasPost_('adminDeleteGreeting', { rowNumber: rowNumber })
    .then(function(res) {
      if (!res || !res.ok) { showToast('Gagal menghapus greeting', 'error'); return; }
      closeDeleteConfirm();
      showToast('Greeting dihapus', 'success');
      _greetingCRUDCache = null;
      gasGet_('adminGetGreetings')
        .then(function(res2) {
          _greetingCRUDCache = res2;
          renderGreetingCRUDList(res2);
          loadAdminGreetingPreview();
        });
    })
    .catch(function() {
      closeDeleteConfirm();
      showToast('Gagal menghapus', 'error');
    });
}

function loadAdminGreetingPreview() {
  var el = document.getElementById('adminGreetingPreviewList');
  if (!el) return;
  gasGet_('adminGetGreetings')
    .then(function(res) {
      if (!res || !res.ok || !res.data || !res.data.length) {
        el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada greeting</p>';
        return;
      }
      el.innerHTML = res.data.slice(0, 3).map(function(d) {
        return '<div class="flex items-center gap-2 py-1">' +
          '<span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ' + (d.aktif ? 'bg-green-400' : 'bg-gray-300') + '"></span>' +
          '<span class="text-xs text-gray-700 truncate flex-1">' + (d.judul || d.konten || d.teks || '') + '</span>' +
          '<span class="text-[10px] text-gray-400 flex-shrink-0">' + (d.mulai || '') + '</span>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

/* ============================================================
   FORM MUDIK
   ============================================================ */
function scrollToPedoman() {
  if (navigator.vibrate) navigator.vibrate(40);
  switchPage('homePage');
  setActiveNavById('navHome');
  setTimeout(function() {
    var sec = document.getElementById('homePedomanSection');
    if (!sec) return;
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function() {
      sec.classList.add('shake');
      setTimeout(function() { sec.classList.remove('shake'); }, 400);
    }, 500);
  }, 100);
}

function openFormMudik() {
  var el = document.getElementById('formMudik');
  if (!el) return;

  // Reset state
  document.getElementById('mudikAgree').checked = false;
  document.getElementById('mudikHpDarurat').value = '';
  document.getElementById('mudikTglPergi').value = '';
  document.getElementById('mudikTglKembali').value = '';
  document.getElementById('mudikNama').value = '';
  document.getElementById('mudikHp1').value = '';
  document.getElementById('mudikBlok').value = '';
  document.getElementById('mudikBlok').readOnly = false;
  document.getElementById('mudikBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');

  var ubahBtn = document.getElementById('mudikUbahBtn');

  if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
    // Sudah login → auto-fill + lock + tampil ubah
    var first = currentUser.wargaData[0];
    document.getElementById('mudikNama').value = first.nama || '';
    document.getElementById('mudikHp1').value  = first.noHp || '';
    document.getElementById('mudikBlok').value = currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    document.getElementById('mudikBlok').readOnly = true;
    document.getElementById('mudikBlok').classList.add('bg-gray-100', 'cursor-not-allowed');
    document.getElementById('mudikNama').readOnly = true;
    document.getElementById('mudikHp1').readOnly  = true;
    if (ubahBtn) ubahBtn.classList.remove('hidden');
  } else {
    // Belum login → blok bisa diisi, nama & HP auto-fill setelah lookup
    document.getElementById('mudikNama').readOnly = true;
    document.getElementById('mudikHp1').readOnly  = true;
    if (ubahBtn) ubahBtn.classList.add('hidden');
  }

  updateMudikSubmitBtn();
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';
  history.pushState({ formMudik: true }, '');
  // Block sidebar navigation while form is open
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
}

function mudikEnableEdit() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengubah data.');
    return;
  }
  document.getElementById('mudikBlok').readOnly = false;
  document.getElementById('mudikBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  document.getElementById('mudikBlok').focus();
  document.getElementById('mudikUbahBtn').classList.add('hidden');
}

var _mudikLookupTimer = null;
function onMudikBlokInput() {
  var val = document.getElementById('mudikBlok').value.trim().toUpperCase();
  document.getElementById('mudikBlok').value = val;
  updateMudikSubmitBtn();

  if (!val) {
    document.getElementById('mudikNama').value = '';
    document.getElementById('mudikHp1').value  = '';
    return;
  }

  // Debounce 800ms → auto lookup
  clearTimeout(_mudikLookupTimer);
  _mudikLookupTimer = setTimeout(function() {
    triggerMudikBlokLookup();
  }, 800);
}

function triggerMudikBlokLookup() {
  var val = document.getElementById('mudikBlok').value.trim().toUpperCase();
  if (!val) return;

  var loading = document.getElementById('mudikBlokLoading');
  if (loading) loading.classList.remove('hidden');

  gasGet_('getResidentByBlock', { blok: val })
    .then(function(res) {
      if (loading) loading.classList.add('hidden');
      if (!res || !res.found) {
        document.getElementById('mudikNama').value = '';
        document.getElementById('mudikHp1').value  = '';
        updateMudikSubmitBtn();
        return;
      }
      document.getElementById('mudikNama').value = res.nama || '';
      document.getElementById('mudikHp1').value  = res.noHp  || '';
      updateMudikSubmitBtn();
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
    });
}

function openFormRenovasi() {
  var el = document.getElementById('formRenovasi');
  if (!el) return;

  // Reset
  document.querySelectorAll('input[name="renovSetuju"]').forEach(function(r) { r.checked = false; });
  var alatBerat = document.querySelector('input[name="renovAlatBerat"][value="Tidak"]');
  if (alatBerat) alatBerat.checked = true;
  document.getElementById('renovTglMulai').value    = '';
  document.getElementById('renovTglSelesai').value  = '';
  document.getElementById('renovRincian').value     = '';
  document.getElementById('renovNamaMandor').value  = '';
  document.getElementById('renovJumlahPekerja').value = '';
  document.getElementById('renovNama').value = '';
  document.getElementById('renovBlok').value = '';
  document.getElementById('renovBlok').readOnly = false;
  document.getElementById('renovBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  removeRenovKtp();

  var ubahBtn = document.getElementById('renovUbahBtn');

  if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
    var first = currentUser.wargaData[0];
    document.getElementById('renovNama').value = first.nama || '';
    document.getElementById('renovBlok').value = currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
    document.getElementById('renovBlok').readOnly = true;
    document.getElementById('renovBlok').classList.add('bg-gray-100', 'cursor-not-allowed');
    document.getElementById('renovNama').readOnly = true;
    if (ubahBtn) ubahBtn.classList.remove('hidden');
  } else {
    document.getElementById('renovNama').readOnly = true;
    if (ubahBtn) ubahBtn.classList.add('hidden');
  }

  updateRenovSubmitBtn();
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';
  history.pushState({ formRenovasi: true }, '');
  // Block sidebar navigation while form is open
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
}

function renovEnableEdit() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengubah data.');
    return;
  }
  document.getElementById('renovBlok').readOnly = false;
  document.getElementById('renovBlok').classList.remove('bg-gray-100', 'cursor-not-allowed');
  document.getElementById('renovBlok').focus();
  document.getElementById('renovUbahBtn').classList.add('hidden');
}

function onRenovBlokInput() {
  var val = document.getElementById('renovBlok').value.trim().toUpperCase();
  document.getElementById('renovBlok').value = val;
  updateRenovSubmitBtn();
  if (!val) {
    document.getElementById('renovNama').value = '';
  }
}

function triggerRenovBlokLookup() {
  var val = document.getElementById('renovBlok').value.trim().toUpperCase();
  if (!val) return;

  var loading = document.getElementById('renovBlokLoading');
  if (loading) loading.classList.remove('hidden');

  gasGet_('getResidentByBlock', { blok: val })
    .then(function(res) {
      if (loading) loading.classList.add('hidden');
      if (!res || !res.found) return;
      document.getElementById('renovNama').value = res.nama || '';
      updateRenovSubmitBtn();
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
    });
}

function closeFormMudik() {
  var el = document.getElementById('formMudik');
  if (!el) return;
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.add('hidden'); document.body.style.overflow = ''; }
  if (history.state && history.state.formMudik) history.back();
}

function updateMudikSubmitBtn() {
  var btn      = document.getElementById('mudikSubmitBtn');
  var agree    = document.getElementById('mudikAgree')?.checked;
  var hpDarurat = (document.getElementById('mudikHpDarurat')?.value || '').trim();
  var tglPergi  = (document.getElementById('mudikTglPergi')?.value || '').trim();
  var tglKembali= (document.getElementById('mudikTglKembali')?.value || '').trim();

  var blokVal = (document.getElementById('mudikBlok')?.value || '').trim();
  if (btn) btn.disabled = !(agree && blokVal && hpDarurat && tglPergi && tglKembali);
}

function submitFormMudik() {
  var btn = document.getElementById('mudikSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Mengirim...'; }

  var payload = {
    blok       : document.getElementById('mudikBlok')?.value || '',
    nama       : document.getElementById('mudikNama')?.value || '',
    noHp1      : document.getElementById('mudikHp1')?.value || '',
    noHpDarurat: document.getElementById('mudikHpDarurat')?.value || '',
    tglPergi   : document.getElementById('mudikTglPergi')?.value || '',
    tglKembali : document.getElementById('mudikTglKembali')?.value || '',
    setuju     : 'Ya'
  };

  gasPost_('submitFormMudik', { payload: payload })
    .then(function() {
      closeFormMudik();
      showToast('Konfirmasi mudik berhasil dikirim 🙏', 'success');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi'; }
    })
    .catch(function() {
      showToast('Gagal mengirim, coba lagi', 'error');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi'; }
    });
}

function closeFormRenovasi() {
  var el = document.getElementById('formRenovasi');
  if (!el) return;
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  var ov = document.getElementById('overlay');
  if (ov) { ov.classList.add('hidden'); document.body.style.overflow = ''; }
  if (history.state && history.state.formRenovasi) history.back();
}

function renovHighlightAgreement() {
  var setuju = document.querySelector('input[name="renovSetuju"]:checked')?.value;
  var ya    = document.getElementById('renovSetujuYaLabel');
  var tidak = document.getElementById('renovSetujuTidakLabel');
  if (!ya || !tidak) return;
  if (setuju === 'Setuju') {
    ya.style.background    = '#FFF7ED'; ya.style.borderColor = '#EA580C';
    tidak.style.background = ''; tidak.style.borderColor = '#D1D5DB';
  } else if (setuju === 'Tidak Setuju') {
    tidak.style.background = '#FEF2F2'; tidak.style.borderColor = '#EF4444';
    ya.style.background    = ''; ya.style.borderColor = '#E5E7EB';
  }
}

function updateRenovSubmitBtn() {
  var btn      = document.getElementById('renovSubmitBtn');
  var setuju   = document.querySelector('input[name="renovSetuju"]:checked')?.value;
  var tglMulai = (document.getElementById('renovTglMulai')?.value || '').trim();
  var tglSelesai=(document.getElementById('renovTglSelesai')?.value || '').trim();
  var rincian  = (document.getElementById('renovRincian')?.value || '').trim();
  var mandor   = (document.getElementById('renovNamaMandor')?.value || '').trim();
  var ktp      = (document.getElementById('renovKtpMandor')?.value || '').trim();
  var jumlah   = (document.getElementById('renovJumlahPekerja')?.value || '').trim();

  // Submit hanya aktif jika setuju = 'Setuju' dan semua field terisi
  var ktpOk = (typeof renovKtpFileUrl !== 'undefined' && renovKtpFileUrl) ? true : false;
  var valid = setuju === 'Setuju' && tglMulai && tglSelesai && rincian && mandor && ktpOk && jumlah;
  if (btn) btn.disabled = !valid;
}

var renovKtpFileUrl = null;

function handleRenovKtpUpload(input) {
  var file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('Ukuran file maksimal 5MB', 'error');
    return;
  }

  var filenameEl = document.getElementById('renovKtpFilename');
  if (filenameEl) {
    filenameEl.innerHTML =
      '<span class="flex items-center gap-2">' +
        '<svg class="w-4 h-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">' +
          '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3"/>' +
          '<path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3"/>' +
        '</svg>' +
        '<span class="text-sm text-gray-500">Mengupload foto KTP...</span>' +
      '</span>';
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    var meta = {
      blok: document.getElementById('renovBlok')?.value || '',
      periode: 'KTP-Mandor',
      nama: document.getElementById('renovNamaMandor')?.value || 'Mandor'
    };

    gasPost_('uploadBuktiTransfer', {
      base64: base64,
      filename: file.name,
      mimeType: file.type,
      meta: meta
    })
      .then(function(res) {
        renovKtpFileUrl = res.url;
        if (filenameEl) {
          filenameEl.innerHTML = '<span class="flex items-center gap-2 text-green-600"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg><span class="text-sm font-medium">' + file.name + '</span></span>';
        }
        var preview = document.getElementById('renovKtpPreview');
        var img = document.getElementById('renovKtpImg');
        var pdf = document.getElementById('renovKtpPdf');
        var pdfName = document.getElementById('renovKtpPdfName');
        preview.classList.remove('hidden');
        if (file.type.startsWith('image/')) {
          img.src = URL.createObjectURL(file);
          img.classList.remove('hidden');
          if (pdf) pdf.classList.add('hidden');
        } else {
          if (pdfName) pdfName.innerText = file.name;
          if (pdf) pdf.classList.remove('hidden');
          img.classList.add('hidden');
        }
        updateRenovSubmitBtn();
      })
      .catch(function() {
        renovKtpFileUrl = null;
        if (filenameEl) {
          filenameEl.innerHTML = '<span class="flex items-center gap-2 text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg><span class="text-sm">Upload gagal, coba lagi</span></span>';
        }
        showToast('Upload KTP gagal', 'error');
        updateRenovSubmitBtn();
      });
  };
  reader.readAsDataURL(file);
}

function removeRenovKtp() {
  renovKtpFileUrl = null;
  document.getElementById('renovKtpUpload').value = '';
  document.getElementById('renovKtpFilename').innerText = 'Ambil foto atau pilih dari galeri';
  document.getElementById('renovKtpPreview').classList.add('hidden');
  document.getElementById('renovKtpImg').src = '';
  document.getElementById('renovKtpImg').classList.add('hidden');
  updateRenovSubmitBtn();
}

function submitFormRenovasi() {
  var btn = document.getElementById('renovSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Mengirim...'; }

  var alatBerat = document.querySelector('input[name="renovAlatBerat"]:checked')?.value || 'Tidak';

  var payload = {
    blok        : document.getElementById('renovBlok')?.value || '',
    nama        : document.getElementById('renovNama')?.value || '',
    tglMulai    : document.getElementById('renovTglMulai')?.value || '',
    tglSelesai  : document.getElementById('renovTglSelesai')?.value || '',
    setuju      : document.querySelector('input[name="renovSetuju"]:checked')?.value || '',
    rincian     : document.getElementById('renovRincian')?.value || '',
    alatBerat   : alatBerat,
    namaMandor  : document.getElementById('renovNamaMandor')?.value || '',
    ktpMandor   : renovKtpFileUrl || '',
    jumlahPekerja: document.getElementById('renovJumlahPekerja')?.value || ''
  };

  gasPost_('submitFormRenovasi', { payload: payload })
    .then(function() {
      closeFormRenovasi();
      showToast('Konfirmasi renovasi berhasil dikirim 🙏', 'success');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi Renovasi'; }
    })
    .catch(function() {
      showToast('Gagal mengirim, coba lagi', 'error');
      if (btn) { btn.disabled = false; btn.innerText = 'Kirim Konfirmasi Renovasi'; }
    });
}

/* ============================================================
   PEDOMAN VIEWER
   ============================================================ */
var _pedomanTitles = {
  '1Lh5hBOSZWwY9mhFob9ESY-s0FnYZ8cEO': 'Pedoman dan Tata Tertib',
  '1R5Z6HvpanZPrPjKUgZkSm9-mpbCOeZhh': 'Hewan Peliharaan',
  '1tHlGGS4N0Ifdme576zbvDLbt9z64Mprt': 'Batas Kecepatan & Lokasi Parkir',
  '1jjFWxgbabwZgov9aQI8CM35tgCMQW13K': 'Struktur Organisasi'
};

function openPedomanViewer(fileId) {
  if (!currentUser) {
    openMePage();
    return;
  }
  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  var title = document.getElementById('pedomanViewerTitle');

  if (!modal || !frame) return;

  frame.src = 'https://drive.google.com/file/d/' + fileId + '/preview';
  if (title) title.innerText = _pedomanTitles[fileId] || 'Dokumen';

  modal.classList.remove('hidden');
  history.pushState({ pedomanViewer: true }, '');
}

function closePedomanViewer() {
  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  if (!modal) return;
  frame.src = 'about:blank';
  frame.style.display = '';
  var banner = document.getElementById('kasIplFallbackBanner');
  if (banner) banner.remove();
  var backBtn = document.getElementById('kasBackBtn');
  if (backBtn) backBtn.remove();
  var dlBtn = document.getElementById('kasDownloadBtn');
  if (dlBtn) dlBtn.remove();
  modal.classList.add('hidden');
}

// ===== PAYMENT BANNER HELPERS =====
function showPaymentSuccessBanner(opts) {
  var o = opts || {};
  var nama = o.nama || 'Warga';
  var blokRaw = o.blok || '';
  var blokLabel = blokRaw ? nama + ' (' + blokRaw + ')' : nama;
  document.getElementById('bannerNamaBlok').textContent = blokLabel;
  document.getElementById('bannerPeriode').textContent = o.periode || '-';
  document.getElementById('bannerNominal').textContent = o.nominal || '-';

  var el = document.getElementById('paymentSuccessBanner');
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closePaymentBanner() {
  var el = document.getElementById('paymentSuccessBanner');
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function sharePaymentToWA() {
  var nama    = document.getElementById('bannerNamaBlok') ? document.getElementById('bannerNamaBlok').textContent : '';
  var periode = document.getElementById('bannerPeriode')  ? document.getElementById('bannerPeriode').textContent  : '-';
  var nominal = document.getElementById('bannerNominal')  ? document.getElementById('bannerNominal').textContent  : '-';

  var btn = document.querySelector('button[onclick="sharePaymentToWA()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyiapkan...';
  }

  var container = document.getElementById('exportReceiptTemplate');
  if (!container) { fallbackShareWA_(nama, periode, nominal, btn); return; }

  container.innerHTML =
    '<div style="' +
      'background:linear-gradient(170deg,#f0fdf4 0%,#ffffff 45%);' +
      'padding:40px 28px 32px 28px;' +
      'display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'box-sizing:border-box;width:360px;' +
    '">' +

      '<div style="' +
        'width:52px;height:52px;border-radius:50%;' +
        'background:rgba(67,160,71,0.1);' +
        'display:flex;align-items:center;justify-content:center;' +
        'margin-bottom:20px;flex-shrink:0;' +
      '">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#43A047" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="20 6 9 17 4 12"></polyline>' +
        '</svg>' +
      '</div>' +

      '<p style="font-size:11px;font-weight:700;color:#43A047;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 16px 0;line-height:1.4;">' +
        'Pembayaran Berhasil Diterima' +
      '</p>' +

      '<p style="font-size:14px;color:#6b7280;margin:0 0 4px 0;line-height:1.5;">' +
        'Hi <span style="font-weight:700;color:#111827;">' + nama + '</span>,' +
      '</p>' +

      '<p style="font-size:12px;color:#9ca3af;margin:0 0 24px 0;line-height:1.6;">' +
        'Terima kasih, pembayaran IPL Anda telah kami terima.' +
      '</p>' +

      '<div style="width:100%;border:1px solid #eeeeee;border-radius:12px;overflow:hidden;margin-bottom:20px;background:#ffffff;">' +

        '<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;height:38px;padding:0 14px;border-bottom:1px solid #f5f5f5;box-sizing:border-box;">' +
          '<span style="font-size:11px;color:#9ca3af;font-weight:400;line-height:38px;height:38px;">Periode</span>' +
          '<span style="font-size:11px;color:#111827;font-weight:600;white-space:nowrap;line-height:38px;height:38px;">' + periode + '</span>' +
        '</div>' +

        '<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;height:38px;padding:0 14px;border-bottom:1px solid #f5f5f5;box-sizing:border-box;">' +
          '<span style="font-size:11px;color:#9ca3af;font-weight:400;line-height:38px;height:38px;">Nominal</span>' +
          '<span style="font-size:11px;color:#2e7d32;font-weight:700;white-space:nowrap;line-height:38px;height:38px;">' + nominal + '</span>' +
        '</div>' +

        '<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;height:38px;padding:0 14px;box-sizing:border-box;">' +
          '<span style="font-size:11px;color:#9ca3af;font-weight:400;line-height:38px;height:38px;">Status</span>' +
          '<div style="display:flex;flex-direction:row;align-items:center;gap:5px;flex-shrink:0;height:38px;">' +
            '<span style="display:inline-block;width:6px;height:6px;min-width:6px;min-height:6px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span>' +
            '<span style="font-size:11px;color:#92400e;font-weight:600;white-space:nowrap;line-height:38px;">Menunggu Verifikasi</span>' +
          '</div>' +
        '</div>' +

      '</div>' +

      '<p style="font-size:11px;color:#9ca3af;line-height:1.7;margin:0 0 6px 0;">' +
        'Data pembayaran di atas sudah tercatat di sistem dan sedang menunggu proses verifikasi oleh pengurus.' +
      '</p>' +

      '<p style="font-size:11px;color:#9ca3af;line-height:1.7;margin:0 0 24px 0;">' +
        'Konfirmasi akan kami sampaikan setelah proses verifikasi selesai.' +
      '</p>' +

      '<p style="font-size:12px;font-weight:700;color:#374151;margin:0 0 4px 0;">Paguyuban Jade Park Serpong 2</p>' +
      '<p style="font-size:11px;color:#d1d5db;margin:0;">Issued by JPortal</p>' +

    '</div>';

  container.style.display = 'block';

  html2canvas(container.firstElementChild, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    width: 360,
    windowWidth: 360
  }).then(function(canvas) {

    container.style.display = 'none';

    canvas.toBlob(function(blob) {
      var isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (isMobile && navigator.share && navigator.canShare) {
        var file = new File([blob], 'bukti-ipl.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] })
            .then(function() { resetShareBtn_(btn); })
            .catch(function() { fallbackShareWA_(nama, periode, nominal, btn); });
          return;
        }
      }
      fallbackShareWA_(nama, periode, nominal, btn);
    }, 'image/jpeg', 0.95);

  }).catch(function(err) {
    container.style.display = 'none';
    console.error('html2canvas error:', err);
    fallbackShareWA_(nama, periode, nominal, btn);
  });
}

function resetShareBtn_(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;flex-shrink:0;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Share ke WhatsApp';
}

function fallbackShareWA_(nama, periode, nominal, btn) {
  var isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile) {
    // Mobile tapi share API tidak support file — fallback text
    var text = '\u2705 *Bukti Pembayaran IPL*\n\n' +
      'Nama   : ' + nama + '\n' +
      'Periode: ' + periode + '\n' +
      'Nominal: ' + nominal + '\n' +
      'Status : Menunggu Verifikasi\n\n' +
      '_Pengurus Paguyuban Jade Park Serpong 2_';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    resetShareBtn_(btn);
    return;
  }

  // Desktop: download image + tampil instruksi
  var container = document.getElementById('exportReceiptTemplate');
  if (!container || !container.firstElementChild) {
    resetShareBtn_(btn);
    return;
  }

  container.style.display = 'block';
  html2canvas(container.firstElementChild, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    width: 360,
    windowWidth: 360
  }).then(function(canvas) {
    container.style.display = 'none';

    // Download image
    var link = document.createElement('a');
    link.download = 'bukti-ipl-' + nama.replace(/\s+/g, '-') + '.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();

    // Toast instruksi
    showToast('Gambar diunduh. Silakan kirim manual ke WhatsApp.', 'info');
    resetShareBtn_(btn);

  }).catch(function() {
    container.style.display = 'none';
    resetShareBtn_(btn);
  });
}

function openInfoSection() {
  // Pastikan di homePage
  openHome();

  setTimeout(function() {
    var target = document.getElementById('homeInfoCarousel');
    if (!target) return;

    // Scroll ke Info Cluster
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Shake effect pada kedua card info
    var cards = [
      target.closest('.mx-5'),
      document.getElementById('homeFasumList') ? document.getElementById('homeFasumList').closest('.mx-5') : null
    ];

    cards.forEach(function(card) {
      if (!card) return;
      card.style.transition = 'transform 0.1s ease';
      var count = 0;
      var interval = setInterval(function() {
        card.style.transform = count % 2 === 0 ? 'translateX(4px)' : 'translateX(-4px)';
        count++;
        if (count > 5) {
          clearInterval(interval);
          card.style.transform = 'translateX(0)';
        }
      }, 80);
    });
  }, 100);
}

function filterContactList(query) {
  var items = document.querySelectorAll('#contactList .contact-item');
  var q = query.toLowerCase();
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

function filterSecurityList(query) {
  var items = document.querySelectorAll('#securityContactList .contact-item');
  var q = query.toLowerCase();
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

function copyRekeningSheet() {
  var noRek = '7305014010';
  var textEl = document.getElementById('copyRekeningSheetText');

  function onSuccess() {
    showToast('Nomor rekening berhasil disalin', 'success');
    if (textEl) textEl.textContent = 'Tersalin!';
    setTimeout(function() {
      if (textEl) textEl.textContent = 'Salin';
    }, 2000);
  }

  function onFail() {
    // Fallback: execCommand
    try {
      var el = document.createElement('textarea');
      el.value = noRek;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      onSuccess();
    } catch(e) {
      showToast('7305014010 · BCA a.n. Imam Jaswidi', 'info');
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(noRek).then(onSuccess).catch(onFail);
  } else {
    onFail();
  }
}

function showDetailPaymentSkeleton_(show) {
  var skeleton = document.getElementById('detailPaymentSkeleton');
  var card     = document.getElementById('detailPaymentCard');
  if (!skeleton || !card) return;
  if (show) {
    skeleton.classList.remove('hidden');
    card.classList.add('hidden');
  } else {
    skeleton.classList.add('hidden');
    card.classList.remove('hidden');
  }
}

/* ============================================================
   KAS IPL VIEWER
   ============================================================ */
var _kasIPLData = {
  '2023': {
    type: 'gsheet',
    // preview via Google Sheets viewer — cukup "Anyone with link"
    url: 'https://docs.google.com/spreadsheets/d/1a3vKtlGe50pKEZvkoAxz3MHmmwe94ZvBBIG0_zNLyL0/preview?gid=1918973875',
    editUrl: 'https://docs.google.com/spreadsheets/d/1a3vKtlGe50pKEZvkoAxz3MHmmwe94ZvBBIG0_zNLyL0/edit?gid=1918973875'
  },
  '2024': {
    type: 'gsheet',
    url: 'https://docs.google.com/spreadsheets/d/194MxUmNtEAkuWmpCdxSn86HdPBiYCGfUvFRJdD6wu3I/preview?gid=1918973875',
    editUrl: 'https://docs.google.com/spreadsheets/d/194MxUmNtEAkuWmpCdxSn86HdPBiYCGfUvFRJdD6wu3I/edit?gid=1918973875'
  },
  '2025': {
    type: 'gsheet',
    url: 'https://docs.google.com/spreadsheets/d/1ogM59jO7CUoSuzFQYXzhLmX7kne0dKKk-HcbiV3KPEY/preview?gid=1029759642',
    editUrl: 'https://docs.google.com/spreadsheets/d/1ogM59jO7CUoSuzFQYXzhLmX7kne0dKKk-HcbiV3KPEY/edit?gid=1029759642'
  },
  '2026': {
    type: 'folder',
    url: 'https://drive.google.com/embeddedfolderview?id=1nN2YFGGQZx3lF6SbGlr_eq_LsaLS0BYU#list',
    fallback: 'https://drive.google.com/drive/folders/1nN2YFGGQZx3lF6SbGlr_eq_LsaLS0BYU'
  }
};

function openKasIPL(year) {
  var data = _kasIPLData[year];
  if (!data) return;

  var modal = document.getElementById('pedomanViewer');
  var frame = document.getElementById('pedomanViewerFrame');
  var title = document.getElementById('pedomanViewerTitle');
  if (!modal || !frame) return;

  if (title) title.innerText = 'Kas IPL ' + year;

  // Reset frame style dulu
  frame.style.background = '';
  frame.style.backgroundColor = '';

  // Hapus fallback banner lama jika ada
  var oldBanner = document.getElementById('kasIplFallbackBanner');
  if (oldBanner) oldBanner.remove();

  if (data.type === 'folder') {
    // Sembunyikan iframe, tampilkan custom list UI
    frame.style.display = 'none';
    modal.classList.remove('hidden');
    history.pushState({ pedomanViewer: true }, '');

    // Inject loading state ke dalam modal body
    var frameParent = frame.parentElement;
    if (frameParent) frameParent.style.position = 'relative';

    var oldBanner2 = document.getElementById('kasIplFallbackBanner');
    if (oldBanner2) oldBanner2.remove();

    var loadingDiv2 = document.createElement('div');
    loadingDiv2.id = 'kasIplFallbackBanner';
    loadingDiv2.style.cssText = 'position:absolute;inset:0;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;';
    loadingDiv2.innerHTML =
      '<svg class="w-7 h-7 text-primary animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>' +
      '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat daftar laporan...</p>';
    if (frameParent) frameParent.appendChild(loadingDiv2);

    // Fetch file list dari Apps Script
    gasGet_('getKasIPL2026Files')
      .then(function(res) {
        var lb2 = document.getElementById('kasIplFallbackBanner');
        if (lb2) lb2.remove();
        if (!res || !res.ok || !res.files.length) {
          _showKasIpl2026Empty_(frameParent);
          return;
        }
        _renderKasIpl2026List_(frameParent, res.files);
      })
      .catch(function() {
        var lb2 = document.getElementById('kasIplFallbackBanner');
        if (lb2) lb2.remove();
        _showKasIpl2026Empty_(frameParent);
      });

    return;
  }

  // gsheet 2023-2025 — langsung load preview, tampilkan loading overlay
  var frameParent = frame.parentElement;
  if (frameParent) frameParent.style.position = 'relative';

  // Loading overlay
  var loadingDiv = document.createElement('div');
  loadingDiv.id = 'kasIplFallbackBanner';
  loadingDiv.style.cssText = 'position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;pointer-events:none;';
  loadingDiv.innerHTML =
    '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10" stroke="#43A047" stroke-width="3"/>' +
    '</svg>' +
    '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat laporan...</p>';

  if (frameParent) frameParent.appendChild(loadingDiv);

  frame.style.display = '';
  frame.src = data.url;
  modal.classList.remove('hidden');
  history.pushState({ pedomanViewer: true }, '');

  // Hapus loading saat iframe selesai load
  frame.onload = function() {
    var lb = document.getElementById('kasIplFallbackBanner');
    if (lb) lb.remove();
  };

  // Safety timeout 10 detik
  setTimeout(function() {
    var lb = document.getElementById('kasIplFallbackBanner');
    if (lb) lb.remove();
  }, 10000);
}

function _showKasIplFallback_(container, url, year) {
  // Tampilkan fallback UI dengan tombol buka di browser
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:#fff',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:16px',
    'padding:32px',
    'z-index:10',
    'font-family:sans-serif',
    'text-align:center'
  ].join(';');

  // Icon
  div.innerHTML =
    '<div style="width:56px;height:56px;background:#f0fdf4;border-radius:16px;display:flex;align-items:center;justify-content:center;">' +
      '<svg width="28" height="28" fill="none" stroke="#16a34a" stroke-width="1.8" viewBox="0 0 24 24">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>' +
      '</svg>' +
    '</div>' +
    '<div>' +
      '<p style="font-size:15px;font-weight:700;color:#111827;margin:0 0 6px 0;">Kas IPL ' + year + '</p>' +
      '<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5;">Dokumen perlu dibuka di Google Sheets</p>' +
    '</div>' +
    '<a href="' + url.replace('/pubhtml?gid', '/edit?gid').replace('&single=true&widget=true&headers=false', '') + '" ' +
       'target="_blank" ' +
       'style="display:flex;align-items:center;gap:8px;' +
              'background:#16a34a;color:#fff;' +
              'padding:12px 24px;border-radius:14px;' +
              'font-size:14px;font-weight:600;' +
              'text-decoration:none;">' +
      '<svg width="16" height="16" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
        '<polyline points="15 3 21 3 21 9"/>' +
        '<line x1="10" y1="14" x2="21" y2="3"/>' +
      '</svg>' +
      'Buka di Google Sheets' +
    '</a>' +
    '<button onclick="closePedomanViewer()" ' +
            'style="font-size:13px;color:#9ca3af;background:none;border:none;cursor:pointer;">' +
      'Tutup' +
    '</button>';

  if (container) container.appendChild(div);
}

function _renderKasIpl2026List_(container, files) {
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;overflow-y:auto;z-index:10;-webkit-overflow-scrolling:touch;';

  var isPdf = function(mime) {
    return mime && mime.toLowerCase().includes('pdf');
  };

  var html =
    '<div style="padding:16px 16px 32px;">' +
      '<p style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 10px 2px;">' +
        files.length + ' Dokumen Tersedia' +
      '</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">';

  files.forEach(function(f) {
    var icon = isPdf(f.mimeType)
      ? '<div style="width:36px;height:36px;border-radius:10px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="#DC2626" stroke-width="1.8" viewBox="0 0 24 24">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/>' +
          '</svg>' +
        '</div>'
      : '<div style="width:36px;height:36px;border-radius:10px;background:#EFF6FF;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="18" height="18" fill="none" stroke="#2563EB" stroke-width="1.8" viewBox="0 0 24 24">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/>' +
          '</svg>' +
        '</div>';

    // Convert Drive URL ke preview URL untuk iframe
    // https://drive.google.com/file/d/FILE_ID/view → https://drive.google.com/file/d/FILE_ID/preview
    var previewUrl = 'https://drive.google.com/file/d/' + f.id + '/preview';
    var escapedName = f.name.replace(/'/g, "\\'");

    html +=
      '<button onclick="_openKasFile_(\'' + f.id + '\', \'' + escapedName + '\')" ' +
         'style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;cursor:pointer;' +
                'background:#ffffff;border-radius:18px;' +
                'padding:14px 14px;border:1px solid #f3f4f6;' +
                'box-shadow:0 1px 4px rgba(0,0,0,0.05);-webkit-tap-highlight-color:transparent;">' +
        icon +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:13px;font-weight:600;color:#111827;margin:0 0 3px 0;' +
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            f.name +
          '</p>' +
          '<p style="font-size:11px;color:#9ca3af;margin:0;font-weight:500;">' + f.date + '</p>' +
        '</div>' +
        '<div style="width:28px;height:28px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M9 18l6-6-6-6"/>' +
          '</svg>' +
        '</div>' +
      '</button>';
  });

  html += '</div></div>';
  div.innerHTML = html;
  if (container) container.appendChild(div);
}

function _showKasIpl2026Empty_(container) {
  var div = document.createElement('div');
  div.id = 'kasIplFallbackBanner';
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;padding:32px;text-align:center;font-family:sans-serif;';
  div.innerHTML =
    '<div style="width:52px;height:52px;background:#f3f4f6;border-radius:16px;display:flex;align-items:center;justify-content:center;">' +
      '<svg width="24" height="24" fill="none" stroke="#9ca3af" stroke-width="1.8" viewBox="0 0 24 24">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<path d="M14 2v6h6"/>' +
      '</svg>' +
    '</div>' +
    '<p style="font-size:14px;font-weight:600;color:#374151;margin:0;">Belum ada laporan</p>' +
    '<p style="font-size:12px;color:#9ca3af;margin:0;">Dokumen akan ditambahkan oleh pengurus</p>' +
    '<button onclick="closePedomanViewer()" ' +
            'style="margin-top:8px;font-size:13px;color:#9ca3af;background:none;border:none;cursor:pointer;">' +
      'Tutup' +
    '</button>';
  if (container) container.appendChild(div);
}

function _openKasFile_(fileId, fileName) {
  var frame  = document.getElementById('pedomanViewerFrame');
  var title  = document.getElementById('pedomanViewerTitle');
  var modal  = document.getElementById('pedomanViewer');
  if (!frame || !modal) return;

  // Hapus banner list
  var banner = document.getElementById('kasIplFallbackBanner');
  if (banner) banner.remove();

  // Update title
  if (title) title.innerText = fileName;

  // Tombol Back + Download di header
  var titleBar = title && title.parentElement;
  if (titleBar) {
    // Hapus tombol lama
    var oldBack = document.getElementById('kasBackBtn');
    if (oldBack) oldBack.remove();
    var oldDl = document.getElementById('kasDownloadBtn');
    if (oldDl) oldDl.remove();

    // === BACK BUTTON ===
    var backBtn = document.createElement('button');
    backBtn.id = 'kasBackBtn';
    backBtn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:13px;' +
                            'color:#43A047;font-weight:600;background:none;border:none;' +
                            'cursor:pointer;padding:4px 8px 4px 0;flex-shrink:0;white-space:nowrap;';
    backBtn.innerHTML =
      '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M19 12H5M12 5l-7 7 7 7"/>' +
      '</svg>Kembali';
    backBtn.onclick = function() {
      // Hapus tombol header tambahan
      var bb = document.getElementById('kasBackBtn');
      if (bb) bb.remove();
      var dl = document.getElementById('kasDownloadBtn');
      if (dl) dl.remove();

      // Reset frame
      frame.src = 'about:blank';
      frame.style.display = 'none';
      if (title) title.innerText = 'Kas IPL 2026';

      // Reload list
      var frameParent = frame.parentElement;
      if (frameParent) frameParent.style.position = 'relative';

      var ld = document.createElement('div');
      ld.id = 'kasIplFallbackBanner';
      ld.style.cssText = 'position:absolute;inset:0;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;';
      ld.innerHTML =
        '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
          '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
          '<path d="M12 2a10 10 0 0 1 10 10" stroke="#43A047" stroke-width="3"/>' +
        '</svg>' +
        '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat daftar laporan...</p>';
      if (frameParent) frameParent.appendChild(ld);

      gasGet_('getKasIPL2026Files')
        .then(function(res) {
          var lb = document.getElementById('kasIplFallbackBanner');
          if (lb) lb.remove();
          if (!res || !res.ok || !res.files.length) {
            _showKasIpl2026Empty_(frameParent);
            return;
          }
          _renderKasIpl2026List_(frameParent, res.files);
        })
        .catch(function() {
          var lb2 = document.getElementById('kasIplFallbackBanner');
          if (lb2) lb2.remove();
          _showKasIpl2026Empty_(frameParent);
        });
    };

    // === DOWNLOAD BUTTON ===
    var dlBtn = document.createElement('a');
    dlBtn.id = 'kasDownloadBtn';
    dlBtn.href = 'https://drive.google.com/uc?export=download&id=' + fileId;
    dlBtn.target = '_blank';
    dlBtn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;' +
                          'color:#fff;font-weight:600;background:#43A047;border:none;' +
                          'cursor:pointer;padding:6px 12px;border-radius:10px;' +
                          'text-decoration:none;flex-shrink:0;margin-left:auto;margin-right:8px;';
    dlBtn.innerHTML =
      '<svg width="14" height="14" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" y1="15" x2="12" y2="3"/>' +
      '</svg>Unduh';

    // Insert: [back] [title] [download] [×]
    titleBar.insertBefore(backBtn, title);
    var closeBtn = modal.querySelector('button');
    if (closeBtn) {
      titleBar.insertBefore(dlBtn, closeBtn);
    } else {
      titleBar.appendChild(dlBtn);
    }
  }

  // === LOADING OVERLAY ===
  var frameParent2 = frame.parentElement;
  if (frameParent2) frameParent2.style.position = 'relative';

  var ldOverlay = document.createElement('div');
  ldOverlay.id = 'kasIplFallbackBanner';
  ldOverlay.style.cssText = 'position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;pointer-events:none;';
  ldOverlay.innerHTML =
    '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
      '<path d="M12 2a10 10 0 0 1 10 10" stroke="#43A047" stroke-width="3"/>' +
    '</svg>' +
    '<p style="font-size:13px;color:#9ca3af;font-family:sans-serif;">Memuat dokumen...</p>';
  if (frameParent2) frameParent2.appendChild(ldOverlay);

  // === LOAD IFRAME ===
  frame.style.display = '';
  // Gunakan Google Docs Viewer sebagai wrapper — lebih stabil di mobile/PWA
  // Tidak trigger reload saat zoom karena Google Docs Viewer handle zoom sendiri
  var viewerUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
  frame.src = viewerUrl;

  frame.onload = function() {
    var lo = document.getElementById('kasIplFallbackBanner');
    if (lo && lo.style.pointerEvents === 'none') lo.remove();
  };

  // Safety remove loading setelah 8 detik
  setTimeout(function() {
    var lo = document.getElementById('kasIplFallbackBanner');
    if (lo && lo.style.pointerEvents === 'none') lo.remove();
  }, 8000);
}

/* Sync hunian card display ke rate bulan yang dipilih
   Hanya update visual jika user BELUM manual override */
function _syncHunianCardToSelectedMonths_() {
  // Jika user sudah manual pilih hunian, jangan override
  var hasManualOverride = Object.keys(userOverrideRateByYear || {}).length > 0;
  if (hasManualOverride) return;
  if (!wargaRateByMonth) return;

  // Cari rate dari bulan pertama yang dipilih
  var dominantRate = 0;
  var years = Object.keys(selectedMonthsByYear || {}).sort();
  for (var yi = 0; yi < years.length; yi++) {
    var yr = years[yi];
    var yrInt = parseInt(yr, 10);
    var months = selectedMonthsByYear[yr] || [];
    var rMap = wargaRateByMonth[yrInt] || {};
    for (var mi = 0; mi < months.length; mi++) {
      var key = yrInt + '_' + months[mi];
      if (rMap[key] && rMap[key] > 0) {
        dominantRate = rMap[key];
        break;
      }
    }
    if (dominantRate) break;
  }

  if (!dominantRate) dominantRate = selectedRate;
  if (!dominantRate) return;

  // Update selectedRate + hunian card visual (tanpa trigger override)
  selectedRate = dominantRate;
  rate = selectedRate;
  document.querySelectorAll('.hunian-card').forEach(function(card) {
    card.classList.remove('active');
    if (Number(card.dataset.value) === selectedRate) {
      card.classList.add('active');
    }
  });
}

/* ========================================================
   LAPOR — Fitur Laporan Masalah
   ======================================================== */

var _laporData_    = [];           // data aktif sesuai tab
var _laporTab_     = 'mine';       // 'mine' | 'all'
var _laporEditing_ = null;         // row data for admin update
var _laporCache_   = { mine: null, all: null }; // cache per tab

function openLaporPage() {
  if (!currentUser) {
    openLoginRequiredModal('Silakan login untuk mengakses Lapor Masalah.');
    return;
  }
  setActiveNavById('navLapor');
  switchPage('laporPage');
  _renderLaporPage_();
}

function _renderLaporPage_() {
  var loginReq   = document.getElementById('laporLoginRequired');
  var emptyState = document.getElementById('laporEmptyState');
  var loading    = document.getElementById('laporLoading');
  var list       = document.getElementById('laporList');
  var tabAll     = document.getElementById('laporTabAll');
  var newBtn     = document.getElementById('laporNewBtn');

  // Show/hide admin tab
  var isAdmin = currentUser && currentUser.role === 'admin';
  if (tabAll) tabAll.classList.toggle('hidden', !isAdmin);

  if (loginReq) loginReq.classList.add('hidden');
  if (newBtn)   newBtn.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');

  var email      = currentUser.email;
  var cacheKey   = _laporTab_; // 'mine' | 'all'
  var adminParam = (isAdmin && _laporTab_ === 'all') ? 'true' : 'false';

  // Gunakan cache jika ada — tampil langsung tanpa loading
  if (_laporCache_[cacheKey] !== null) {
    if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
    _laporData_ = _laporCache_[cacheKey];
    if (_laporData_.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
    } else {
      _renderLaporList_(_laporData_);
    }
    // Refresh di background diam-diam
    gasGet_('getPengaduanList', { email: email, isAdmin: adminParam })
      .then(function(res) {
        if (!res.ok) return;
        _laporCache_[cacheKey] = res.data || [];
        // Update tampilan hanya jika tab masih sama
        if (_laporTab_ === cacheKey) {
          _laporData_ = _laporCache_[cacheKey];
          if (_laporData_.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (list) list.innerHTML = '';
          } else {
            if (emptyState) emptyState.classList.add('hidden');
            _renderLaporList_(_laporData_);
          }
        }
      }).catch(function() {});
    return;
  }

  // Belum ada cache — tampilkan loading
  if (loading)  { loading.classList.remove('hidden'); loading.style.display = 'flex'; }
  if (list)     list.innerHTML = '';

  gasGet_('getPengaduanList', { email: email, isAdmin: adminParam })
    .then(function(res) {
      if (loading) { loading.classList.add('hidden'); loading.style.display = ''; }
      if (!res.ok) { showToast('Gagal memuat laporan','error'); return; }
      _laporCache_[cacheKey] = res.data || [];
      _laporData_ = _laporCache_[cacheKey];
      if (_laporData_.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
      } else {
        _renderLaporList_(_laporData_);
      }
    })
    .catch(function() {
      if (loading) loading.classList.add('hidden');
      showToast('Gagal memuat laporan','error');
    });
}

function _renderLaporList_(data) {
  var list = document.getElementById('laporList');
  if (!list) return;
  var isAdmin = currentUser && currentUser.role === 'admin';

  var statusConfig = {
    'Masuk'    : { cls: 'lapor-badge-masuk',    emoji: '🔴', label: 'Masuk' },
    'Diproses' : { cls: 'lapor-badge-diproses',  emoji: '🔵', label: 'Diproses' },
    'Selesai'  : { cls: 'lapor-badge-selesai',   emoji: '🟢', label: 'Selesai' },
    'Ditolak'  : { cls: 'lapor-badge-ditolak',   emoji: '⚫', label: 'Ditolak' }
  };

  list.innerHTML = data.map(function(item, idx) {
    var sc = statusConfig[item.status] || statusConfig['Masuk'];
    return '<div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2 cursor-pointer active:opacity-80 transition"'
      + ' onclick="_openLaporDetail_(' + idx + ')">'
      + '<div class="flex items-start justify-between gap-2">'
      + '<div class="flex-1 min-w-0">'
      + '<p class="text-sm font-bold text-gray-900 truncate">' + _esc_(item.judul) + '</p>'
      + (isAdmin && _laporTab_ === 'all' ? '<p class="text-xs text-gray-400 mt-0.5">' + _esc_(item.nama) + ' · ' + _esc_(item.unit) + '</p>' : '')
      + '</div>'
      + '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ' + sc.cls + '">' + sc.label + '</span>'
      + '</div>'
      + '<div class="flex items-center gap-2 flex-wrap">'
      + '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>'
      + '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>'
      + '</div>'
      + (item.catatan ? '<p class="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">' + _esc_(item.catatan) + '</p>' : '')
      + '</div>';
  }).join('');
}

function _esc_(str) {
  return (str || '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function switchLaporTab(tab) {
  _laporTab_ = tab;
  var tabMine = document.getElementById('laporTabMine');
  var tabAll  = document.getElementById('laporTabAll');
  var active  = 'border-b-2 border-primary text-primary font-semibold';
  var inactive = 'border-b-2 border-transparent text-gray-400 font-medium';
  if (tabMine) tabMine.className = 'py-3 text-sm transition-all ' + (tab === 'mine' ? active : inactive);
  if (tabAll)  tabAll.className  = 'py-3 text-sm transition-all ' + (tab === 'all'  ? active : inactive);
  _renderLaporPage_();
}

// ── FORM ──────────────────────────────────────────────

function openLaporForm() {
  if (!currentUser) { openPageSaya(); return; }
  var sheet = document.getElementById('laporFormSheet');
  var card  = document.getElementById('laporFormCard');
  if (!sheet || !card) return;
  // Reset
  var sel = document.getElementById('laporKategori');
  var jdl = document.getElementById('laporJudul');
  var dsk = document.getElementById('laporDeskripsi');
  var err = document.getElementById('laporFormError');
  if (sel) sel.value = '';
  if (jdl) jdl.value = '';
  if (dsk) dsk.value = '';
  if (err) err.classList.add('hidden');

  sheet.classList.remove('hidden');
  card.style.transform = 'translateY(100%)';
  requestAnimationFrame(function() {
    card.style.transition = 'transform 0.3s ease';
    card.style.transform = 'translateY(0)';
  });
}

function closeLaporForm() {
  var sheet = document.getElementById('laporFormSheet');
  var card  = document.getElementById('laporFormCard');
  if (!sheet || !card) return;
  card.style.transform = 'translateY(100%)';
  setTimeout(function() { sheet.classList.add('hidden'); }, 280);
}

function submitLaporForm() {
  var kategori  = (document.getElementById('laporKategori')?.value  || '').trim();
  var judul     = (document.getElementById('laporJudul')?.value     || '').trim();
  var deskripsi = (document.getElementById('laporDeskripsi')?.value || '').trim();
  var isAnon    = document.getElementById('laporAnonymous')?.checked || false;
  var err       = document.getElementById('laporFormError');
  var btn       = document.getElementById('laporSubmitBtn');
  var icon      = document.getElementById('laporSubmitIcon');
  var spinner   = document.getElementById('laporSubmitSpinner');
  var label     = document.getElementById('laporSubmitLabel');

  if (!kategori || !judul || !deskripsi) {
    if (err) { err.textContent = 'Kategori, judul, dan deskripsi wajib diisi.'; err.classList.remove('hidden'); }
    return;
  }
  if (err) err.classList.add('hidden');

  // Show spinner
  if (btn)     btn.disabled = true;
  if (icon)    icon.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');
  if (label)   label.textContent = 'Mengirim...';

  var payload = {
    email    : isAnon ? '' : currentUser.email,
    nama     : isAnon ? 'Anonim' : (currentUser.fullName || currentUser.name || currentUser.email),
    unit     : isAnon ? '' : (currentUser.blok || ''),
    kategori : kategori,
    judul    : judul,
    deskripsi: deskripsi
  };

  function _resetBtn_() {
    if (btn)     btn.disabled = false;
    if (icon)    icon.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (label)   label.textContent = 'Kirim Laporan';
  }

  gasPost_('submitPengaduan', { payload: payload })
    .then(function(res) {
      _resetBtn_();
      if (!res.ok) {
        if (err) { err.textContent = res.error || 'Gagal mengirim laporan.'; err.classList.remove('hidden'); }
        return;
      }
      closeLaporForm();
      showToast('✅ Laporan terkirim! ID: ' + res.id, 'success');
      _laporCache_ = { mine: null, all: null }; // invalidate cache
      setTimeout(function() { _renderLaporPage_(); }, 400);
    })
    .catch(function() {
      _resetBtn_();
      if (err) { err.textContent = 'Gagal mengirim. Coba lagi.'; err.classList.remove('hidden'); }
    });
}

// ── DETAIL ────────────────────────────────────────────

function _openLaporDetail_(idx) {
  var item = _laporData_[idx];
  if (!item) return;
  var modal = document.getElementById('laporDetailModal');
  var body  = document.getElementById('laporDetailBody');
  if (!modal || !body) return;

  var isAdmin = currentUser && currentUser.role === 'admin';
  var statusOptions = ['Masuk','Diproses','Selesai','Ditolak'];

  body.innerHTML = ''
    + '<div class="flex items-center gap-2 flex-wrap">'
    + '<span class="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>'
    + '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">ID Laporan</p>'
    + '<p class="text-sm font-bold text-gray-900">' + _esc_(item.id) + '</p>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Judul</p>'
    + '<p class="text-sm font-semibold text-gray-900">' + _esc_(item.judul) + '</p>'
    + '</div>'
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Deskripsi</p>'
    + '<p class="text-sm text-gray-700 leading-relaxed">' + _esc_(item.deskripsi) + '</p>'
    + '</div>'
    + (isAdmin ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Pelapor</p>'
        + '<p class="text-sm text-gray-700">' + _esc_(item.nama) + ' · ' + _esc_(item.unit) + '</p></div>' : '')
    + '<div>'
    + '<p class="text-[11px] text-gray-400 uppercase tracking-widest mb-1">Status</p>'
    + (isAdmin
      ? '<select id="laporDetailStatus" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none">'
          + statusOptions.map(function(s) {
              return '<option value="' + s + '"' + (item.status === s ? ' selected' : '') + '>' + s + '</option>';
            }).join('')
          + '</select>'
      : '<span class="text-sm font-semibold text-gray-900">' + _esc_(item.status) + '</span>')
    + '</div>'
    + (isAdmin
      ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-1">Catatan Admin</p>'
          + '<textarea id="laporDetailCatatan" rows="3" placeholder="Catatan untuk warga..."'
          + ' class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none resize-none">'
          + _esc_(item.catatan || '') + '</textarea></div>'
          + '<button onclick="_saveLaporStatus_(' + item.rowNumber + ')"'
          + ' class="w-full py-3 bg-primary text-white font-bold text-sm rounded-2xl active:opacity-80 transition">'
          + 'Simpan Update</button>'
      : (item.catatan ? '<div><p class="text-[11px] text-gray-400 uppercase tracking-widest mb-0.5">Catatan Panitia</p>'
          + '<p class="text-sm text-gray-700 bg-blue-50 rounded-xl px-3 py-2">' + _esc_(item.catatan) + '</p></div>' : ''));

  modal.classList.remove('hidden');
}

function closeLaporDetail() {
  var modal = document.getElementById('laporDetailModal');
  if (modal) modal.classList.add('hidden');
}

function _saveLaporStatus_(rowNumber) {
  var status  = document.getElementById('laporDetailStatus')?.value  || '';
  var catatan = document.getElementById('laporDetailCatatan')?.value || '';
  if (!status) return;

  gasPost_('updatePengaduanStatus', {
    rowNumber  : rowNumber,
    status     : status,
    catatan    : catatan,
    adminEmail : currentUser.email
  })
  .then(function(res) {
    if (!res.ok) { showToast('Gagal update','error'); return; }
    closeLaporDetail();
    showToast('Status laporan diupdate!','success');
    _laporCache_ = { mine: null, all: null }; // invalidate cache
    _renderLaporPage_();
  })
  .catch(function() { showToast('Gagal update','error'); });
}

// ===== FITUR DAFTAR WARGA =====

function openDaftarSheet() {
  var sheet = document.getElementById('daftarFormSheet');
  if (!sheet) return;
  // Reset to form state
  document.getElementById('daftarFormBody').classList.remove('hidden');
  document.getElementById('daftarSuccessBody').classList.add('hidden');
  // Clear fields
  var n = document.getElementById('daftarNama'); if (n) n.value = '';
  var b = document.getElementById('daftarBlok'); if (b) b.value = '';
  var w = document.getElementById('daftarWA'); if (w) w.value = '';
  var s = document.querySelectorAll('input[name="daftarStatus"]');
  s.forEach(function(r) { r.checked = false; });
  var err = document.getElementById('daftarError');
  if (err) { err.classList.add('hidden'); err.querySelector('span').textContent = ''; }
  var btn = document.getElementById('daftarSubmitBtn');
  if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
  sheet.classList.remove('hidden');
}

function closeDaftarSheet() {
  var sheet = document.getElementById('daftarFormSheet');
  if (sheet) sheet.classList.add('hidden');
}

function submitDaftarForm() {
  var nama   = (document.getElementById('daftarNama')?.value || '').trim();
  var blok   = (document.getElementById('daftarBlok')?.value || '').trim().toUpperCase();
  var email  = (document.getElementById('daftarEmail')?.value || '').trim().toLowerCase();
  var waRaw  = (document.getElementById('daftarWA')?.value || '').trim().replace(/\D/g, '');
  var wa     = waRaw ? '62' + waRaw.replace(/^0+/, '') : '';
  var status = document.querySelector('input[name="daftarStatus"]:checked')?.value || '';

  var errEl   = document.getElementById('daftarError');
  var errSpan = errEl?.querySelector('span');

  function showErr(msg) {
    if (errEl && errSpan) {
      errSpan.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  if (!nama)   { showErr('Nama lengkap wajib diisi.'); return; }
  if (!blok)   { showErr('Blok rumah wajib diisi.'); return; }
  if (!email)  { showErr('Email wajib diisi.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('Format email tidak valid.'); return; }
  if (!waRaw)  { showErr('No. WhatsApp wajib diisi.'); return; }
  if (!status) { showErr('Status hunian wajib dipilih.'); return; }

  if (errEl) errEl.classList.add('hidden');

  var btn = document.getElementById('daftarSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-4 h-4 inline-block mr-2 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Mengirim...';
  }

  gasPost_('registerWarga', { nama: nama, blok: blok, email: email, wa: wa, status: status })
    .then(function(res) {
      if (!res.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
        showErr(res.message || 'Gagal mengirim pengajuan. Coba lagi.');
        return;
      }
      // Show success
      document.getElementById('daftarFormBody').classList.add('hidden');
      document.getElementById('daftarSuccessBody').classList.remove('hidden');
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Kirim Pengajuan'; }
      showErr('Gagal mengirim. Periksa koneksi internet kamu.');
    });
}

// ===== ADMIN: WARGA BARU =====

var _pendingAktifkanRow_ = null;

function loadWargaBaru() {
  var loading = document.getElementById('wargaBaruLoading');
  var empty   = document.getElementById('wargaBaruEmpty');
  var list    = document.getElementById('wargaBaruList');
  if (!list) return;

  if (loading) { loading.classList.remove('hidden'); loading.classList.add('flex'); }
  if (empty)   empty.classList.add('hidden');
  list.innerHTML = '';

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      if (loading) { loading.classList.add('hidden'); loading.classList.remove('flex'); }
      if (!res || !res.ok || !res.data || res.data.length === 0) {
        if (empty) empty.classList.remove('hidden');
        _updateWargaBaruBadge_(0);
        return;
      }
      _updateWargaBaruBadge_(res.data.length);
      list.innerHTML = res.data.map(function(w) {
        return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
          '<div class="flex items-start justify-between gap-2 mb-3">' +
            '<div class="flex items-center gap-2.5">' +
              '<div class="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">' +
                '<svg class="w-4.5 h-4.5 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '</div>' +
              '<div>' +
                '<p class="text-sm font-bold text-gray-900">' + _esc_(w.nama) + '</p>' +
                '<p class="text-xs text-gray-400">' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</p>' +
              '</div>' +
            '</div>' +
            '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 font-semibold px-2 py-1 rounded-full flex-shrink-0">Belum Aktif</span>' +
          '</div>' +
          '<div class="space-y-1.5 mb-3">' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>' +
              '<span class="truncate">' + _esc_(w.email) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 10 19.79 19.79 0 0 1 1.61 1.4 2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 7.91a16 16 0 0 0 6.29 6.29l1.07-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '<span>' + _esc_(w.noHp) + '</span>' +
            '</div>' +
            (w.submittedAt ? '<div class="flex items-center gap-2 text-xs text-gray-400">' +
              '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
              '<span>Daftar: ' + _esc_(w.submittedAt) + '</span>' +
            '</div>' : '') +
          '</div>' +
          '<button onclick="konfirmasiAktifkan(' + w.rowNumber + ',\'' + _esc_(w.nama) + '\',\'' + _esc_(w.blok) + '\')"' +
                  ' class="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl active:scale-95 transition shadow-sm shadow-primary/20">' +
            '<svg class="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan Akun' +
          '</button>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      if (loading) { loading.classList.add('hidden'); loading.classList.remove('flex'); }
      if (list) list.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>';
    });
}

function _updateWargaBaruBadge_(count) {
  var badge = document.getElementById('wargaBaruTabCount');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
    badge.className = 'px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold';
  } else {
    badge.classList.add('hidden');
  }
}

var _aktifkanFromCRUD_ = false;

function konfirmasiAktifkan(rowNumber, nama, blok, fromCRUD) {
  _pendingAktifkanRow_ = rowNumber;
  _aktifkanFromCRUD_   = !!fromCRUD;
  var desc = document.getElementById('modalAktifkanDesc');
  if (desc) desc.textContent = nama + ' (Blok ' + blok + ') akan bisa login setelah diaktifkan.';
  var modal = document.getElementById('modalAktifkanWarga');
  if (modal) modal.classList.remove('hidden');
}

function closeModalAktifkan() {
  var modal = document.getElementById('modalAktifkanWarga');
  if (modal) modal.classList.add('hidden');
  _pendingAktifkanRow_ = null;
}

function doAktifkanWarga() {
  if (!_pendingAktifkanRow_) return;
  var btn = document.getElementById('btnDoAktifkan');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

  gasPost_('activateUser', { rowNumber: _pendingAktifkanRow_, adminEmail: currentUser.email })
    .then(function(res) {
      closeModalAktifkan();
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan'; }
      if (!res.ok) { showToast(res.message || 'Gagal mengaktifkan', 'error'); return; }
      showToast('Akun berhasil diaktifkan! WA terkirim ke warga.', 'success');
      // Bust warga baru cache so next open is fresh
      _adminWargaBaruCache_ = null; sessionStorage.removeItem('exploreWargaBaruCache');
      if (_aktifkanFromCRUD_) {
        _loadWargaBaruCRUDList_();
        loadAdminWargaBaruPreview();
      } else {
        loadWargaBaru();
      }
    })
    .catch(function() {
      closeModalAktifkan();
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan'; }
      showToast('Gagal mengaktifkan akun', 'error');
    });
}

// ===== ADMIN PANEL: WARGA BARU PREVIEW =====

function _renderAdminWargaBaruPreview_(res) {
  var el    = document.getElementById('adminWargaBaruPreviewList');
  var badge = document.getElementById('adminWargaBadge');
  if (!el) return;
  if (!res || !res.ok || !res.data || res.data.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-1 text-center">Tidak ada pengajuan baru</p>';
    if (badge) badge.classList.add('hidden');
    var sc = document.getElementById('scAdminWargaBaru'); if (sc) sc.textContent = '0';
    return;
  }
  var count = res.data.length;
  if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }
  var sc = document.getElementById('scAdminWargaBaru'); if (sc) sc.textContent = count;
  var preview = res.data.slice(0, 3).map(function(w) {
    return '<div class="flex items-center justify-between py-1">' +
      '<div><span class="text-xs font-semibold text-gray-800">' + _esc_(w.nama) + '</span>' +
      '<span class="text-[10px] text-gray-400 ml-1.5">Blok ' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</span></div>' +
      '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 font-semibold px-1.5 py-0.5 rounded-full">Pending</span>' +
    '</div>';
  }).join('');
  if (count > 3) preview += '<p class="text-[10px] text-gray-400 mt-0.5">+' + (count-3) + ' lainnya</p>';
  el.innerHTML = preview;
}

function loadAdminWargaBaruPreview() {
  var el = document.getElementById('adminWargaBaruPreviewList');
  if (!el || !currentUser) return;

  // Return from cache if available
  if (_adminWargaBaruCache_) { _renderAdminWargaBaruPreview_(_adminWargaBaruCache_); return; }
  var cached = _ssGetExplore_('exploreWargaBaruCache');
  if (cached) { _adminWargaBaruCache_ = cached; _renderAdminWargaBaruPreview_(cached); return; }

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      _adminWargaBaruCache_  = res;
      _ssSetExplore_('exploreWargaBaruCache', res);
      _renderAdminWargaBaruPreview_(res);
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

function openDashboardWargaBaru() {
  openWargaBaruCRUD(); // redirect to modal instead
}

function openWargaBaruCRUD() {
  var modal = document.getElementById('wargaBaruCRUDModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Use cache if available — only fetch on first open or after cache bust
  if (_adminWargaBaruCache_ && _adminWargaBaruCache_.data) {
    _renderWargaBaruCRUDFromCache_(_adminWargaBaruCache_.data);
  } else {
    _loadWargaBaruCRUDList_();
  }
}

function closeWargaBaruCRUD() {
  var modal = document.getElementById('wargaBaruCRUDModal');
  if (modal) modal.classList.add('hidden');
}

function _loadWargaBaruCRUDList_() {
  var el    = document.getElementById('wargaBaruCRUDList');
  var badge = document.getElementById('wargaBaruCRUDBadge');
  if (!el) return;

  el.innerHTML = '<div class="flex flex-col items-center justify-center py-10 gap-3">' +
    '<svg class="w-7 h-7 text-primary animate-spin" fill="none" viewBox="0 0 24 24">' +
      '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>' +
      '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>' +
    '</svg>' +
    '<p class="text-xs text-gray-400">Memuat data...</p>' +
  '</div>';

  gasGet_('getPendingRegistrations', { email: currentUser.email })
    .then(function(res) {
      _adminWargaBaruCache_ = res;
      _ssSetExplore_('exploreWargaBaruCache', res);
      _renderWargaBaruCRUDFromCache_(res && res.data ? res.data : []);
    })
    .catch(function() {
      var el = document.getElementById('wargaBaruCRUDList');
      if (el) el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>';
    });
}

function _renderWargaBaruCRUDFromCache_(data) {
  var el    = document.getElementById('wargaBaruCRUDList');
  var badge = document.getElementById('wargaBaruCRUDBadge');
  if (!el) return;

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3 text-center">' +
      '<div class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500">Tidak ada pengajuan baru</p>' +
      '<p class="text-xs text-gray-400">Semua pengajuan sudah diproses</p>' +
    '</div>';
    if (badge) badge.classList.add('hidden');
    return;
  }

  var count = data.length;
  if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }

  el.innerHTML = data.map(function(w) {
        return '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">' +
          '<div class="flex items-start justify-between gap-2 mb-3">' +
            '<div class="flex items-center gap-2.5">' +
              '<div class="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">' +
                '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '</div>' +
              '<div>' +
                '<p class="text-sm font-bold text-gray-900">' + _esc_(w.nama) + '</p>' +
                '<p class="text-xs text-gray-400">Blok ' + _esc_(w.blok) + ' · ' + _esc_(w.statusHunian) + '</p>' +
              '</div>' +
            '</div>' +
            '<span class="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 font-semibold px-2 py-1 rounded-full flex-shrink-0">Belum Aktif</span>' +
          '</div>' +
          '<div class="space-y-1.5 mb-3">' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>' +
              '<span class="truncate">' + _esc_(w.email) + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 text-xs text-gray-500">' +
              '<svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 10 19.79 19.79 0 0 1 1.61 1.4 2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 7.91a16 16 0 0 0 6.29 6.29l1.07-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '<span>' + _esc_(w.noHp) + '</span>' +
            '</div>' +
            (w.submittedAt ? '<div class="flex items-center gap-2 text-xs text-gray-400">' +
              '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
              '<span>Daftar: ' + _esc_(w.submittedAt) + '</span>' +
            '</div>' : '') +
          '</div>' +
          '<button onclick="konfirmasiAktifkan(' + w.rowNumber + ',\'' + _esc_(w.nama) + '\',\'' + _esc_(w.blok) + '\',true)"' +
                  ' class="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl active:scale-95 transition shadow-sm shadow-primary/20">' +
            '<svg class="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Aktifkan Akun' +
          '</button>' +
        '</div>';
  }).join('');
}

// ===== ADMIN: KELOLA PENGADUAN =====

var _adminLaporData_  = [];
var _adminLaporTab_   = 'all';

var _LAPOR_STATUS_CFG_ = {
  'Masuk'    : { bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dotCls: 'bg-red-500' },
  'Diproses' : { bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-blue-200',   dotCls: 'bg-blue-500' },
  'Selesai'  : { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dotCls: 'bg-green-500' },
  'Ditolak'  : { bg: 'bg-gray-100',  text: 'text-gray-500',   border: 'border-gray-200',   dotCls: 'bg-gray-400' }
};
function _statusDot_(cfg) { return '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 ' + (cfg.dotCls||'bg-gray-400') + '"></span>'; }

function _renderAdminLaporPreview_(res) {
  var el    = document.getElementById('adminLaporPreviewList');
  var badge = document.getElementById('adminLaporBadge');
  if (!el) return;
  if (!res || !res.ok || !res.data || res.data.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Belum ada laporan</p>';
    if (badge) badge.classList.add('hidden');
    return;
  }
  var pending = res.data.filter(function(d) { return d.status === 'Masuk'; });
  if (badge && pending.length > 0) {
    badge.textContent = pending.length; badge.classList.remove('hidden');
  } else if (badge) { badge.classList.add('hidden'); }
  var scMasuk = document.getElementById('scAdminLaporMasuk');
  var scTotal = document.getElementById('scAdminLaporTotal');
  if (scMasuk) scMasuk.textContent = pending.length;
  if (scTotal) scTotal.textContent = '/ ' + res.data.length;
  var counts = {};
  res.data.forEach(function(d) { counts[d.status] = (counts[d.status]||0)+1; });
  el.innerHTML = Object.keys(counts).map(function(s) {
    var cfg = _LAPOR_STATUS_CFG_[s] || {};
    return '<div class="flex items-center justify-between py-1">' +
      '<span class="text-xs text-gray-700 flex items-center gap-1.5">' + _statusDot_(cfg) + ' ' + s + '</span>' +
      '<span class="text-xs font-bold text-gray-900">' + counts[s] + '</span>' +
    '</div>';
  }).join('');
}

function loadAdminLaporPreview() {
  var el = document.getElementById('adminLaporPreviewList');
  if (!el || !currentUser) return;

  // Return from cache if available
  if (_adminLaporCache_) { _renderAdminLaporPreview_(_adminLaporCache_); return; }
  var cached = _ssGetExplore_('exploreLaporCache');
  if (cached) { _adminLaporCache_ = cached; _renderAdminLaporPreview_(cached); return; }

  gasGet_('getPengaduanList', { email: currentUser.email, isAdmin: 'true' })
    .then(function(res) {
      _adminLaporCache_ = res;
      _ssSetExplore_('exploreLaporCache', res);
      _renderAdminLaporPreview_(res);
    })
    .catch(function() {
      el.innerHTML = '<p class="text-xs text-red-400 py-2 text-center">Gagal memuat</p>';
    });
}

function openAdminPengaduan() {
  var modal = document.getElementById('adminPengaduanModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _adminLaporTab_ = 'all';
  _setAdminLaporTabUI_('all');
  // Use cache if available — only fetch on first open or after cache bust
  if (_adminLaporCache_ && _adminLaporCache_.data) {
    _adminLaporData_ = _adminLaporCache_.data;
    _renderAdminPengaduanList_();
  } else {
    _loadAdminPengaduanList_();
  }
}

function closeAdminPengaduan() {
  var modal = document.getElementById('adminPengaduanModal');
  if (modal) modal.classList.add('hidden');
}

function switchAdminLaporTab(tab) {
  _adminLaporTab_ = tab;
  _setAdminLaporTabUI_(tab);
  _renderAdminPengaduanList_();
}

function _setAdminLaporTabUI_(active) {
  var tabs = ['all','Masuk','Diproses','Selesai','Ditolak'];
  var ids  = { all:'apTab_all', Masuk:'apTab_masuk', Diproses:'apTab_diproses', Selesai:'apTab_selesai', Ditolak:'apTab_ditolak' };
  tabs.forEach(function(t) {
    var el = document.getElementById(ids[t]);
    if (!el) return;
    if (t === active) {
      el.className = 'admin-lapor-tab flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-800 text-white transition';
    } else {
      el.className = 'admin-lapor-tab flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 text-gray-500 transition';
    }
  });
}

function _loadAdminPengaduanList_() {
  var el = document.getElementById('adminPengaduanList');
  if (!el) return;
  el.innerHTML = '<div class="flex flex-col items-center justify-center py-10 gap-3">' +
    '<svg class="w-7 h-7 text-primary animate-spin" fill="none" viewBox="0 0 24 24">' +
      '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>' +
      '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>' +
    '</svg>' +
    '<p class="text-xs text-gray-400">Memuat laporan...</p>' +
  '</div>';

  gasGet_('getPengaduanList', { email: currentUser.email, isAdmin: 'true' })
    .then(function(res) {
      if (!res || !res.ok) { el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>'; return; }
      _adminLaporData_ = res.data || [];
      _renderAdminPengaduanList_();
    })
    .catch(function() { el.innerHTML = '<p class="text-sm text-red-400 text-center py-6">Gagal memuat data</p>'; });
}

function _renderAdminPengaduanList_() {
  var el   = document.getElementById('adminPengaduanList');
  if (!el) return;

  var data = _adminLaporTab_ === 'all'
    ? _adminLaporData_
    : _adminLaporData_.filter(function(d) { return d.status === _adminLaporTab_; });

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3 text-center">' +
      '<div class="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">' +
        '<svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
      '</div>' +
      '<p class="text-sm font-semibold text-gray-500">Tidak ada laporan</p>' +
    '</div>';
    return;
  }

  el.innerHTML = data.map(function(item, idx) {
    var cfg = _LAPOR_STATUS_CFG_[item.status] || _LAPOR_STATUS_CFG_['Masuk'];
    var realIdx = _adminLaporData_.indexOf(item);
    return '<div onclick="openAdminPengaduanDetail(' + realIdx + ')"' +
           ' class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer active:opacity-75 transition">' +
      '<div class="flex items-start justify-between gap-2 mb-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold text-gray-900 truncate">' + _esc_(item.judul) + '</p>' +
          '<p class="text-xs text-gray-400 mt-0.5">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.unit) + '</p>' +
        '</div>' +
        '<span class="text-[10px] font-bold px-2 py-1 rounded-full border flex-shrink-0 flex items-center gap-1 ' + cfg.bg + ' ' + cfg.text + ' ' + cfg.border + '">' +
          _statusDot_(cfg) + ' ' + item.status +
        '</span>' +
      '</div>' +
      '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>' +
        '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>' +
        (item.handler ? '<span class="text-[11px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full">→ ' + _esc_(item.handler) + '</span>' : '') +
      '</div>' +
      (item.catatan ? '<p class="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-1.5 mt-2 line-clamp-1">' + _esc_(item.catatan) + '</p>' : '') +
    '</div>';
  }).join('');
}

function openAdminPengaduanDetail(idx) {
  var item = _adminLaporData_[idx];
  if (!item) return;
  var modal = document.getElementById('adminPengaduanDetailModal');
  var body  = document.getElementById('adminPengaduanDetailBody');
  if (!modal || !body) return;

  var statusOptions = ['Masuk','Diproses','Selesai','Ditolak'];
  var cfg = _LAPOR_STATUS_CFG_[item.status] || _LAPOR_STATUS_CFG_['Masuk'];

  body.innerHTML =
    '<div class="flex items-center gap-2 flex-wrap">' +
      '<span class="text-[10px] font-bold px-2 py-1 rounded-full border flex items-center gap-1 ' + cfg.bg + ' ' + cfg.text + ' ' + cfg.border + '">' + _statusDot_(cfg) + ' ' + item.status + '</span>' +
      '<span class="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">' + _esc_(item.kategori) + '</span>' +
      '<span class="text-[11px] text-gray-400">' + item.timestamp + '</span>' +
    '</div>' +
    '<div class="bg-gray-50 rounded-2xl p-3 space-y-2">' +
      '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest">ID</p><p class="text-xs font-mono text-gray-700">' + _esc_(item.id) + '</p></div>' +
      '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest">Pelapor</p><p class="text-sm font-semibold text-gray-900">' + _esc_(item.nama) + ' · Blok ' + _esc_(item.unit) + '</p></div>' +
    '</div>' +
    '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Judul</p><p class="text-sm font-semibold text-gray-900">' + _esc_(item.judul) + '</p></div>' +
    '<div><p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Deskripsi</p><p class="text-sm text-gray-700 leading-relaxed">' + _esc_(item.deskripsi) + '</p></div>' +
    '<div>' +
      '<p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Update Status</p>' +
      '<div class="grid grid-cols-2 gap-2">' +
        statusOptions.map(function(s) {
          var c = _LAPOR_STATUS_CFG_[s];
          var isActive = item.status === s;
          return '<button onclick="_quickSetLaporStatus_(' + item.rowNumber + ',\'' + s + '\',' + idx + ')"' +
            ' class="py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center justify-center gap-1.5 ' +
            (isActive ? c.bg + ' ' + c.text + ' ' + c.border : 'bg-gray-50 text-gray-400 border-gray-200') + '">' +
            _statusDot_(c) + ' ' + s +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div>' +
      '<p class="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Catatan untuk Warga</p>' +
      '<textarea id="adminLaporCatatan" rows="3" placeholder="Misal: sudah dikonfirmasi ke petugas..."' +
        ' class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none resize-none">' +
        _esc_(item.catatan || '') + '</textarea>' +
    '</div>' +
    '<button onclick="_saveAdminLaporStatus_(' + item.rowNumber + ',' + idx + ')"' +
      ' class="w-full py-3.5 bg-primary text-white font-bold text-sm rounded-2xl active:scale-95 transition shadow-md shadow-primary/20">' +
      'Simpan Update & Kirim WA ke Warga' +
    '</button>';

  modal.classList.remove('hidden');
}

function closeAdminPengaduanDetail() {
  var modal = document.getElementById('adminPengaduanDetailModal');
  if (modal) modal.classList.add('hidden');
}

// Quick status change from grid buttons
function _quickSetLaporStatus_(rowNumber, status, idx) {
  // Update visual selection
  var body = document.getElementById('adminPengaduanDetailBody');
  if (body) {
    body.querySelectorAll('button[onclick*="_quickSetLaporStatus_"]').forEach(function(btn) {
      var btnStatus = btn.getAttribute('onclick').match(/'([^']+)'/)?.[1];
      var c = _LAPOR_STATUS_CFG_[btnStatus] || {};
      if (btnStatus === status) {
        btn.className = 'py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ' + c.bg + ' ' + c.text + ' ' + c.border;
      } else {
        btn.className = 'py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 bg-gray-50 text-gray-400 border-gray-200';
      }
    });
  }
  // Store selection for save
  if (_adminLaporData_[idx]) _adminLaporData_[idx]._selectedStatus_ = status;
}

function _saveAdminLaporStatus_(rowNumber, idx) {
  var item    = _adminLaporData_[idx];
  var status  = (item && item._selectedStatus_) || item.status;
  var catatan = document.getElementById('adminLaporCatatan')?.value || '';

  var btn = document.querySelector('#adminPengaduanDetailBody button[onclick*="_saveAdminLaporStatus_"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

  gasPost_('updatePengaduanStatus', {
    rowNumber : rowNumber,
    status    : status,
    catatan   : catatan,
    adminEmail: currentUser.email
  })
  .then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Update & Kirim WA ke Warga'; }
    if (!res.ok) { showToast('Gagal update', 'error'); return; }
    // Update local data
    if (item) { item.status = status; item.catatan = catatan; delete item._selectedStatus_; }
    // Update cache with new status so preview stays consistent
    if (_adminLaporCache_ && _adminLaporCache_.data) {
      var cached = _adminLaporCache_.data.find(function(d) { return d.rowNumber === rowNumber; });
      if (cached) { cached.status = status; cached.catatan = catatan; }
      _ssSetExplore_('exploreLaporCache', _adminLaporCache_);
    }
    closeAdminPengaduanDetail();
    showToast('Status diupdate! WA terkirim ke warga.', 'success');
    _renderAdminPengaduanList_();
    _renderAdminLaporPreview_(_adminLaporCache_); // refresh preview from updated cache
  })
  .catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Update & Kirim WA ke Warga'; }
    showToast('Gagal update', 'error');
  });
}


/* ============================================================
   NOTIFICATION SYSTEM — JPortal
   Polling-based, personal + public + admin categories
   ============================================================ */

var notifUnreadCount  = 0;
var notifLastTs       = localStorage.getItem('notif_lastTs') || '';
var notifAllItems     = [];
var notifPanelOpen    = false;
var notifPollingTimer = null;

// Notif icons — satu tema: rounded square bg + SVG putih, konsisten dengan app icon style
function _notifIconHtml_(subType) {
  var cfg = {
    ipl_submit  : { bg:'#3B82F6', d:'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4' },
    ipl_confirm : { bg:'#10B981', d:'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    ipl_reject  : { bg:'#EF4444', d:'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' },
    pedoman     : { bg:'#8B5CF6', d:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    kas         : { bg:'#F59E0B', d:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    info_cluster: { bg:'#6366F1', d:'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
    info_fasum  : { bg:'#14B8A6', d:'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    info        : { bg:'#94A3B8', d:'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
  };
  var c = cfg[subType] || cfg['info'];
  return '<div class="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style="background:' + c.bg + '">'
    + '<svg class="w-4 h-4" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="' + c.d + '"/>'
    + '</svg></div>';
}

function initNotifications() {
  if (!currentUser || !currentUser.email) return;
  var btn = document.getElementById('notifBellBtn');
  if (btn) btn.classList.remove('hidden');
  fetchNotifications_();
  if (notifPollingTimer) clearInterval(notifPollingTimer);
  notifPollingTimer = setInterval(fetchNotifications_, 30000);
}

function fetchNotifications_() {
  if (!currentUser || !currentUser.email) return;
  gasGet_('getNotifications', {
    email : currentUser.email,
    lastTs: notifLastTs
  }).then(function(res) {
    if (!res || !res.success) return;
    var newItems = res.notifications || [];
    if (newItems.length > 0) {
      notifAllItems = newItems.concat(notifAllItems).slice(0, 50);
      notifUnreadCount += newItems.length;
      _updateNotifBadge_();
      _renderNotifList_();
      if (!notifPanelOpen) _playNotifBeep_();
      _showBrowserNotif_(newItems);
    }
    if (res.serverTime) {
      notifLastTs = res.serverTime;
      localStorage.setItem('notif_lastTs', notifLastTs);
    }
  }).catch(function() {});
}

function _updateNotifBadge_() {
  var badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (notifUnreadCount > 0) {
    badge.textContent = notifUnreadCount > 99 ? '99+' : String(notifUnreadCount);
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
  }
}

function _renderNotifList_() {
  var list = document.getElementById('notifList');
  if (!list) return;
  if (!notifAllItems.length) {
    list.innerHTML = '<div class="flex flex-col items-center justify-center py-12 gap-3"><svg class="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg><p class="text-sm text-gray-400">Tidak ada notifikasi</p></div>';
    return;
  }
  list.innerHTML = notifAllItems.map(function(n) {
    var d  = n.timestamp ? new Date(n.timestamp) : null;
    var ts = d ? d.toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
    return '<div class="flex items-center gap-3 px-5 py-3.5">'
      + _notifIconHtml_(n.subType)
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-semibold text-gray-900 leading-snug">' + _escHtml_(n.title) + '</p>'
        + '<p class="text-xs text-gray-500 mt-0.5 leading-relaxed">' + _escHtml_(n.body) + '</p>'
        + '<p class="text-[10px] text-gray-300 mt-1">' + ts + '</p>'
      + '</div>'
    + '</div>';
  }).join('');
}

function _escHtml_(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggleNotifPanel() {
  var panel    = document.getElementById('notifPanel');
  var backdrop = document.getElementById('notifBackdrop');
  var spacer   = document.getElementById('notifPanelSpacer');
  if (!panel) return;

  // Spacer = tinggi header agar konten panel mulai tepat di bawah header
  var header  = document.querySelector('header');
  var headerH = header ? header.getBoundingClientRect().height : 56;
  if (spacer) spacer.style.height = headerH + 'px';

  notifPanelOpen = !notifPanelOpen;
  if (notifPanelOpen) {
    panel.style.transform     = 'translateY(0)';
    panel.style.pointerEvents = 'auto';
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.style.top = headerH + 'px'; // backdrop mulai bawah header
    }
    notifUnreadCount = 0;
    _updateNotifBadge_();
  } else {
    panel.style.transform     = 'translateY(-100%)';
    panel.style.pointerEvents = 'none';
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function _playNotifBeep_() {
  try {
    var ctx  = new (window.AudioContext || window.webkitAudioContext)();
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(_) {}
}

function _showBrowserNotif_(items) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') { Notification.requestPermission(); return; }
  if (Notification.permission !== 'granted') return;
  items.slice(0, 3).forEach(function(n) {
    try {
      new Notification(n.title || 'JPortal', {
        body: n.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png'
      });
    } catch(_) {}
  });
}

/* ============================================================
   GREETING BANNER — slide otomatis tiap 5 detik
   ============================================================ */
var _bannerTimer_   = null;
var _bannerIdx_     = 0;

// Palet warna banner — satu tone family, cukup vivid
var _BANNER_PALETTES_ = [
  'linear-gradient(135deg,#4f46e5,#7c3aed)', // indigo → violet
  'linear-gradient(135deg,#0f766e,#0891b2)', // teal → cyan
  'linear-gradient(135deg,#1d4ed8,#4f46e5)', // blue → indigo
  'linear-gradient(135deg,#7c3aed,#db2777)', // violet → pink
  'linear-gradient(135deg,#065f46,#0f766e)', // emerald → teal
  'linear-gradient(135deg,#1e40af,#0f766e)'  // navy → teal
];

function startGreetingBanner_(items) {
  if (!items || !items.length) return;

  var wrap   = document.getElementById('greetingBannerWrap');
  var dotsEl = document.getElementById('greetingBannerDots');
  if (!wrap) return;

  wrap.classList.remove('hidden');

  if (dotsEl) {
    dotsEl.innerHTML = items.length > 1
      ? items.map(function(_, i) {
          return '<span class="banner-dot transition-all duration-300 rounded-full"'
            + ' style="height:4px;width:' + (i===0?'16':'6') + 'px;'
            + 'background:rgba(255,255,255,' + (i===0?'0.9':'0.4') + ');display:inline-block;"></span>';
        }).join('')
      : '';
  }

  // Reset & mulai dari idx 0
  if (_bannerTimer_) clearInterval(_bannerTimer_);
  _bannerIdx_ = 0;
  _showBannerSlide_(items, 0);

  if (items.length > 1) {
    _bannerTimer_ = setInterval(function() {
      _bannerIdx_ = (_bannerIdx_ + 1) % items.length;
      _showBannerSlide_(items, _bannerIdx_);
    }, 10000); // 10 detik
  }
}

var _bannerTypingTimer_ = null;
var _bannerTypingToken_ = 0; // token untuk cancel typing lama

function _showBannerSlide_(items, idx) {
  var slideEl  = document.getElementById('greetingBannerSlide');
  var titleEl  = document.getElementById('greetingBannerTitle');
  var textEl   = document.getElementById('greetingBannerText');
  var dotsEl   = document.getElementById('greetingBannerDots');
  var bgEl     = document.getElementById('greetingBannerWrap');
  if (!slideEl || !titleEl || !textEl) return;

  var item = items[idx] || {};

  // Cancel semua typing yang sedang berjalan
  _bannerTypingToken_++;
  var myToken = _bannerTypingToken_;
  if (_bannerTypingTimer_) { clearTimeout(_bannerTypingTimer_); _bannerTypingTimer_ = null; }

  // Ganti warna background
  var innerBg = bgEl && bgEl.querySelector('.relative.rounded-2xl');
  if (innerBg) {
    innerBg.style.transition = 'background 0.6s ease';
    innerBg.style.background = _BANNER_PALETTES_[idx % _BANNER_PALETTES_.length];
  }

  // Update dots
  if (dotsEl) {
    dotsEl.querySelectorAll('.banner-dot').forEach(function(dot, i) {
      dot.style.width      = i === idx ? '16px' : '6px';
      dot.style.background = i === idx ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    });
  }

  // Set konten langsung (tanpa slide jika pertama kali / idx===0 on load)
  titleEl.textContent = item.judul  || '';
  textEl.textContent  = '';

  // Slide animasi hanya jika bukan render pertama
  var isFirstRender = !slideEl.dataset.rendered;
  slideEl.dataset.rendered = '1';

  if (!isFirstRender) {
    slideEl.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    slideEl.style.transform  = 'translateY(8px)';
    slideEl.style.opacity    = '0';
  }

  function startTyping() {
    if (myToken !== _bannerTypingToken_) return; // dibatalkan
    var fullText = item.konten || '';
    if (!fullText) return;
    var charIdx  = 0;
    var speed    = Math.max(14, Math.min(35, Math.floor(2500 / fullText.length)));
    function typeNext() {
      if (myToken !== _bannerTypingToken_) return; // dibatalkan
      if (charIdx >= fullText.length) return;
      textEl.textContent += fullText[charIdx];
      charIdx++;
      _bannerTypingTimer_ = setTimeout(typeNext, speed);
    }
    typeNext();
  }

  if (!isFirstRender) {
    setTimeout(function() {
      if (myToken !== _bannerTypingToken_) return;
      slideEl.style.transition = 'none';
      slideEl.style.transform  = 'translateY(-8px)';
      slideEl.style.opacity    = '0';
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (myToken !== _bannerTypingToken_) return;
          slideEl.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
          slideEl.style.transform  = 'translateY(0)';
          slideEl.style.opacity    = '1';
          setTimeout(startTyping, 200);
        });
      });
    }, 300);
  } else {
    // Pertama kali: langsung tampil tanpa animasi slide
    slideEl.style.transform = 'translateY(0)';
    slideEl.style.opacity   = '1';
    startTyping();
  }
}

/* ============================================================
   DARK MODE TOGGLE
   ============================================================ */
(function() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
    _applyDarkModeIcons_(true);
  }
})();

function toggleDarkMode() {
  var isDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  _applyDarkModeIcons_(isDark);
}

function _applyDarkModeIcons_(isDark) {
  var sun  = document.getElementById('iconSun');
  var moon = document.getElementById('iconMoon');
  if (sun)  sun.classList.toggle('hidden', !isDark);
  if (moon) moon.classList.toggle('hidden',  isDark);
}

function _showDarkModeBtn_() {
  var btn = document.getElementById('darkModeBtn');
  if (btn) btn.classList.remove('hidden');
}
