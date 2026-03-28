const GAS_URL = 'https://script.google.com/macros/s/AKfycbwH20yDwPhsqoumW6ALtgObIv73X88dqtlggYgO-sk0A1gRW0_d083z6o-GsMpFErjp4A/exec';

function gasGet_(action, params) {
  var url = GAS_URL + '?action=' + action;
  if (params) {
    Object.keys(params).forEach(function(k) {
      url += '&' + k + '=' + encodeURIComponent(params[k]);
    });
  }
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
    let wargaRateByMonth = null; // { '2025': { '2025_0': 200000, '2025_7': 175000 }, ... }
    let userOverrideRateByYear = {}; // { '2025': 175000, '2026': 200000 }
    let selectedMonthsByYear = {}; // { '2025': [6], '2026': [1] }
    let blokToastTimeout = null;
    let activeToastTimer = null;
    let blokSuggestionIndex = -1;
    let currentSuggestions = [];

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
    (function() {
      var restoredUser = loadSession();
      if (restoredUser) {
        currentUser = restoredUser;
        setTimeout(function() {
          updateHeaderAuthUI();
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
      const infoEl = document.getElementById('headerUserInfo');
      if (!infoEl) return;

      if (!currentUser) {
        infoEl.classList.add('hidden');
        infoEl.innerText = '';
        updateTarifDisplay_(false);
        return;
      }

      infoEl.classList.add('hidden');
      updateTarifDisplay_(true);
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
      document.getElementById('sayaStepEmail')?.classList.add('hidden');
      document.getElementById('sayaLoggedInView')?.classList.remove('hidden');

      // ===== RE-RENDER BLOK LIST =====
      if (currentUser && currentUser.wargaData && currentUser.wargaData.length) {
        var listEl = document.getElementById('sayaBlokList');
        if (listEl) {
          listEl.innerHTML = '';
          var blokLabels = currentUser.wargaData
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
        var nameEl  = document.getElementById('sayaProfileName');
        var profEmail = document.getElementById('sayaProfileEmail');

        if (namaEl)    namaEl.value  = currentUser.wargaData[0].nama  || '';
        if (hpEl)      hpEl.value    = currentUser.wargaData[0].noHp  || '';
        if (emailEl)   emailEl.value = currentUser.wargaData[0].email || currentUser.email || '';
        if (nameEl)    nameEl.innerText  = currentUser.fullName || '';
        if (profEmail) profEmail.innerText = currentUser.email || '';
        if (badgeEl && currentUser.wargaData.length) {
          badgeEl.innerText = 'Blok ' + currentUser.wargaData.map(function(d){ return d.blok; }).join(', ');
        }
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

    function backToEmailStep() {
      document.getElementById('sayaStepOTP')?.classList.add('hidden');
      document.getElementById('sayaStepEmail')?.classList.remove('hidden');
    }

    // ===== DASHBOARD CACHE STATE =====
    let dashboardCache = null;
    let dashboardPendingCache = [];
    let dashboardConfirmedCache = [];
    let dashboardRejectedCache = [];

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
      const regex = /^[A-Z][0-9]{1,3}$/;

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

      gasGet_('getResidentByBlock', { blok: val })
        .then(function(res) {
          setBlokSearchLoading(false);
          if (blokLoading) blokLoading.classList.add('hidden');
          if (!res || !res.found) {
            residentSuggestion = null;
            if (suggestionBox) suggestionBox.classList.add('hidden');
            return;
          }
          handleResidentResult(res);
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

      const clean = phone.replace(/\s/g, '');
      if (clean.length <= 6) return clean;

      // Tampilkan 4 depan + 3 belakang, tengah di-mask
      return (
        clean.slice(0, 4) +
        '*'.repeat(Math.max(2, clean.length - 7)) +
        clean.slice(-3)
      );
    }

    function handleResidentResult(res) {

      residentSuggestion = res;

      const card = suggestionBox;
      const text = suggestionText;

      const inputBloks = blokInput.value
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
              wargaPaidMonths  = null;
              wargaRateByMonth = null;
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

          blokInput.value = suggestions[0];

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
      const helperText    = document.getElementById('tanggalHelperText');
      if (!tanggalInput) return;

      const val   = tanggalInput.value;
      const today = formatDateISO(new Date());
      const isToday = val === today;
      const hasVal  = !!val;

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
        } else {
          badge.classList.add('hidden');
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

      var yr   = parseInt(selectedYear, 10);
      var paid = (wargaPaidMonths && wargaPaidMonths[yr]) ? wargaPaidMonths[yr] : [];

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
              // Ambil rate blok ini dari rateByBlokMonth jika ada
              var blokRate = rateNum / bloksArr.length; // fallback equal split
              if (window._rateByBlokMonth_ && window._rateByBlokMonth_[blokName]) {
                var brm = window._rateByBlokMonth_[blokName];
                var key0 = yrInt + '_' + mIdxs[0];
                if (brm[key0]) blokRate = brm[key0];
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

      wargaPaidMonths  = res.paid;
      wargaRateByMonth = res.rateByMonth || null;
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
        document.querySelectorAll('.hunian-card').forEach(function(card) {
          card.classList.remove('active');
          if (Number(card.dataset.value) === selectedRate) {
            card.classList.add('active');
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

      // === 3) Update chip states (paid=grey, overdue=merah) ===
      updateChipStates_();

      // === 4) Auto-suggest bulan pertama yang belum bayar ===
      var autoYear = selectedYear;
      var yrInt    = parseInt(autoYear, 10);
      var paidInYear = (wargaPaidMonths && wargaPaidMonths[yrInt]) ? wargaPaidMonths[yrInt] : [];

      var now3        = new Date();
      var currentYear3 = now3.getFullYear();
      var currentMonth3 = now3.getMonth(); // 0-based (Mar = 2)

      // Untuk tahun berjalan: suggest s.d. bulan ini (inklusif)
      // Untuk tahun lampau: semua 12 bulan
      var maxSuggestMonth = (yrInt === currentYear3) ? currentMonth3 : 11;

      var firstUnpaid = -1;
      for (var mi3 = 0; mi3 <= maxSuggestMonth; mi3++) {
        if (!paidInYear.includes(mi3)) {
          firstUnpaid = mi3;
          break;
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
            document.querySelectorAll('.hunian-card').forEach(function(card) {
              card.classList.remove('active');
              if (Number(card.dataset.value) === selectedRate) {
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

      if (currentUser && currentUser.role === 'admin') {
        // Admin → tampilkan picker dulu
        if (identitySection) identitySection.classList.remove('hidden');
        openAdminBayarPicker();
        return;
      }

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
            rateByMonth: wargaRateByMonth,
            defaultRate: currentUser._cachedDefaultRate || 0
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

    function validateAndSubmit() {
      let valid = true;

      // reset error
      document.querySelectorAll('.error').forEach(el => el.remove());
      document.querySelectorAll('.app-input').forEach(el =>
        el.classList.remove('border-red-500')
      );

      function error(el, msg) {
        valid = false;
        el.classList.add('border-red-500');

        const e = document.createElement('div');
        e.className = 'error text-xs text-red-500 mt-1';
        e.innerText = msg;
        el.after(e);
      }

      const required = [
        ['nama', 'Nama wajib diisi'],
        ['blok', 'Nomor blok wajib diisi'],
        ['hp', 'Nomor HP wajib diisi'],
        ['email', 'Email wajib diisi'],
        ['tanggal', 'Tanggal bayar wajib diisi'],
        ['tahun', 'Tahun wajib dipilih'],
        ['nominal', 'Jumlah pembayaran wajib diisi'],
        ['rekening', 'Nama pemilik rekening wajib diisi']
      ];

      required.forEach(([id, msg]) => {
        const el = document.getElementById(id);
        if (!el || !el.value.trim()) error(el, msg);
      });

      if (!document.querySelector('input[name="hunian"]:checked')) {
        alert('Status tinggal wajib dipilih');
        valid = false;
      }

      if (!document.querySelectorAll('.chip.active').length) {
        alert('Minimal pilih satu bulan pembayaran');
        valid = false;
      }

      if (!valid) return;

      submitForm(); // lanjut ke Apps Script
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

    function setActive(menu) {
      document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.remove('active');
      });

      event.currentTarget.classList.add('active');
    }


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

    /* ================= GLOBAL SUBMIT ================= */
    const scrollEl = document.getElementById('sheetScroll');
    const submitCTA = document.getElementById('submitCTA');

    if (scrollEl && submitCTA) {
      scrollEl.addEventListener('scroll', () => {
        const threshold = 80; // jarak sebelum mentok bawah
        const isNearBottom =
          scrollEl.scrollTop + scrollEl.clientHeight >=
          scrollEl.scrollHeight - threshold;

        if (isNearBottom) {
          submitCTA.classList.remove('hidden');
        } else {
          submitCTA.classList.add('hidden');
        }
      });
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

        statusTinggal: selectedRate === 200000
          ? 'Rumah Dihuni'
          : 'Rumah Tidak Dihuni',

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
        .then(function() {
          enableSubmit();
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

      const isError = type === 'error';

      const bg = isError ? 'bg-red-100' : 'bg-green-100';
      const iconColor = isError ? 'text-red-600' : 'text-green-600';

      const icon = isError
        ? `<path stroke-linecap="round" stroke-linejoin="round"
            d="M6 18L18 6M6 6l12 12"/>`
        : `<path stroke-linecap="round" stroke-linejoin="round"
            d="M5 13l4 4L19 7"/>`;

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

      requestAnimationFrame(() => {
        toastInner.classList.remove('opacity-0', 'translate-y-3');
      });

      if (activeToastTimer) {
        clearTimeout(activeToastTimer);
      }

      activeToastTimer = setTimeout(() => {

        toastInner.classList.add('opacity-0', 'translate-y-3');

        setTimeout(() => {
          toast.classList.add('hidden');
          toastInner.innerHTML = '';
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
          const text = this.innerText.toLowerCase();
          if (text !== 'custom') {
            document.querySelectorAll('.filter-date-chip')
              .forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            activeTimeFilter = text;
            // 🔥 INI RESET CUSTOM
            customDateRange = null;
            customPanel.classList.add('hidden');
            applyFilters();
          }
        });

      });

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

      const customDateInput =
        document.getElementById('customDateInput');
        customDateInput?.addEventListener('change', function() {
        if (!this.value) return;
        customDateRange = {
          start: this.value,
          end: this.value
        };
        // reset chip active
        document.querySelectorAll('.filter-date-chip')
          .forEach(c => c.classList.remove('active'));
        applyFilters();
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
        dashboardCache = response;
        dashboardPendingCache   = response.pending   || [];
        dashboardConfirmedCache = response.confirmed || [];
        dashboardRejectedCache  = response.rejected  || [];
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
    const navItems = document.querySelectorAll('.nav-app');
    navItems.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(navId);
    if (activeBtn) activeBtn.classList.add('active');
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

    // STAGE 1 — Checking
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

    gasPost_('requestLoginOTP', { email: email })
      .then(function(res) {
        if (!res || !res.success) {
          btn.disabled = false;
          btn.innerHTML = 'Kirim Kode OTP';
          var errSpan = errorEl.querySelector('span');
          if (errSpan) errSpan.innerText = res && res.message ? res.message : 'Email tidak ditemukan di sistem';
          errorEl.classList.remove('hidden');
          var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
          if (emailCard) shakeField(emailCard);
          if (navigator.vibrate) navigator.vibrate(40);
          return;
        }
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Email ditemukan</span>';
        setTimeout(function() {
          btn.innerHTML = '<span class="flex items-center justify-center gap-2"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="white" stroke-width="3" fill="none"/></svg>Mengirim OTP...</span>';
          setTimeout(function() {
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
              otpStep.classList.add('saya-step');
              setTimeout(function() { otpStep.classList.remove('saya-step'); }, 300);
            }, 180);
            var sentTo = document.getElementById('otpSentTo');
            if (sentTo) sentTo.innerHTML = 'Kode dikirim ke <span class="text-primary font-semibold">' + email + '</span>';
            initOTPBoxes();
            startOTPCountdown();
            btn.disabled = false;
            btn.innerHTML = 'Kirim Kode OTP';
          }, 800);
        }, 600);
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Kirim Kode OTP';
        var errSpan = errorEl.querySelector('span');
        if (errSpan) errSpan.innerText = 'Gagal mengirim OTP';
        errorEl.classList.remove('hidden');
        var emailCard = document.getElementById('sayaEmailInput')?.closest('.bg-white');
        if (emailCard) shakeField(emailCard);
        if (navigator.vibrate) navigator.vibrate(40);
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
        loadHomeData();
        gasGet_('getCurrentUserDataWarga', { email: res.user.email })
          .then(function(dataRes) {
            if (dataRes && dataRes.success) {
              currentUser.wargaData = dataRes.data || [];
            }
          });
        document.getElementById('sayaStepOTP').classList.add('hidden');
        document.getElementById('sayaProfileName').innerText = res.user.fullName || 'User';
        document.getElementById('sayaProfileEmail').innerText = res.user.email;
        document.getElementById('sayaLoggedInView').classList.remove('hidden');
        document.body.classList.remove('saya-open');
        var badgeEl = document.getElementById('sayaProfileBlokBadge');
        if (badgeEl && res.user.blocks && res.user.blocks.length) {
          badgeEl.innerText = 'Blok ' + res.user.blocks.join(', ');
        }
        gasGet_('getCurrentUserDataWarga', { email: res.user.email })
          .then(function(wRes) {
            if (!wRes || !wRes.success) return;
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
            showToast('Anda telah login', 'success');
          });
      })
      .catch(function() {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi';
        errorEl.innerText = 'Verifikasi gagal';
        errorEl.classList.remove('hidden');
      });
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
      // DEV BYPASS: ketik 000000 untuk skip OTP
      if (otp === '000000') {
        var devEmail = document.getElementById('sayaEmailInput')
          ? document.getElementById('sayaEmailInput').value.trim()
          : '';
        gasGet_('getUserByEmail', { email: devEmail })
          .then(function(res) {
            if (!res || !res.success) {
              showToast('Email tidak ditemukan', 'error');
              return;
            }
            currentUser = res.user;
            saveSession(res.user);
            updateHeaderAuthUI();
            loadHomeData();
            gasGet_('getCurrentUserDataWarga', { email: res.user.email })
              .then(function(dataRes) {
                if (dataRes && dataRes.success) currentUser.wargaData = dataRes.data || [];
              });
            document.getElementById('sayaStepOTP').classList.add('hidden');
            document.getElementById('sayaProfileName').innerText = res.user.fullName || 'User';
            document.getElementById('sayaProfileEmail').innerText = res.user.email;
            document.getElementById('sayaLoggedInView').classList.remove('hidden');
            document.body.classList.remove('saya-open');
            gasGet_('getCurrentUserDataWarga', { email: res.user.email })
              .then(function(wRes) {
                if (!wRes || !wRes.success) return;
                var namaEl  = document.getElementById('sayaNamaInput');
                var hpEl    = document.getElementById('sayaHpInput');
                var emailEl = document.getElementById('sayaEmailEditInput');
                if (namaEl)  namaEl.value  = wRes.data[0].nama  || '';
                if (hpEl)    hpEl.value    = wRes.data[0].noHp  || '';
                if (emailEl) emailEl.value = wRes.data[0].email || '';
                showToast('DEV: Login bypass aktif', 'success');
              });
          })
          .catch(function() {
            showToast('Gagal bypass login', 'error');
          });
        return;
      }

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
      wargaPaidMonths = null;
      wargaRateByMonth = null;
      userOverrideRateByYear = {};
      selectedMonthsByYear = {};
      homeDataCache.tunggakan = null;
      homeDataCache.contact = null;
      homeDataCache.security = null;
      dashboardCache = null;
      dashboardPendingCache = [];
      dashboardConfirmedCache = [];

      // 2. Update auth UI (tarif mask, header)
      updateHeaderAuthUI();

      // 3. Reset logout modal
      closeLogoutConfirm();
      document.body.classList.remove('saya-open');

      // 4. Reset step saya
      document.getElementById('sayaLoggedInView').classList.add('hidden');
      document.getElementById('sayaStepEmail').classList.remove('hidden');
      document.getElementById('sayaStepOTP').classList.add('hidden');
      document.getElementById('sayaEmailInput').value = '';
      document.getElementById('sayaOTPInput').value = '';
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
        greetEl.innerText = hour < 11 ? 'Selamat pagi 🌤️' :
                            hour < 15 ? 'Selamat siang ☀️' :
                            hour < 18 ? 'Selamat sore 🌆' : 'Selamat malam 🌙';
      }

      // 7. Reset tunggakan card (currentUser sudah null, loadHomeTunggakan akan mask)
      loadHomeTunggakan();

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

  function enableSayaEdit() {
    var namaEl  = document.getElementById('sayaNamaInput');
    var hpEl    = document.getElementById('sayaHpInput');
    var editBtn = document.getElementById('sayaEditBtn');
    var saveBtn = document.getElementById('sayaSaveBtn');

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

    if (editBtn) editBtn.classList.add('hidden');
    if (saveBtn) saveBtn.classList.remove('hidden');

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

    // Warga: render semua sekaligus
    var isAdmin = currentUser && currentUser.role === 'admin';
    if (!isAdmin) {
      renderList(getFilteredDataForTab('all_warga'));
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
              applyFilters();
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
          applyFilters();
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

    var pendingBtn   = document.getElementById('tabPending');
    var confirmedBtn = document.getElementById('tabConfirmed');

    if (!pendingBtn || !confirmedBtn) return;

    // Reset both
    pendingBtn.classList.remove('active');
    confirmedBtn.classList.remove('active');

    // Set inactive style
    pendingBtn.className   = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200 active:scale-95 transition tab-pill';
    confirmedBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200 active:scale-95 transition tab-pill';

    if (type === 'pending') {
      pendingBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200 active:scale-95 transition tab-pill active';
    } else {
      confirmedBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-green-50 text-green-700 border border-green-200 active:scale-95 transition tab-pill active';
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
    showToast('Silakan pilih rating terlebih dahulu', 'success');
    return;
  }

  if (!currentUser || !currentUser.email) {
    showToast('Session tidak ditemukan', 'error');
    return;
  }


  if (!currentUser || !currentUser.email) {
    showToast('Session tidak ditemukan', 'success');
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

function openRekeningInfo() {
  const el = document.getElementById('rekeningInfoSection');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateHomeGreeting() {
  const greetEl = document.getElementById('homeGreeting');
  const nameEl  = document.getElementById('homeUsername');
  if (!greetEl || !nameEl) return;

  const hour = new Date().getHours();
  const greeting =
    hour < 11 ? 'Selamat pagi 🌤️' :
    hour < 15 ? 'Selamat siang ☀️' :
    hour < 18 ? 'Selamat sore 🌆' : 'Selamat malam 🌙';

  greetEl.innerText = greeting;

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
  } else {
    nameEl.innerText = 'Warga JPS2';
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
  preloadContactData();
  preloadSecurityContacts();
}

function loadHomeDataIfNeeded() {
    updateHomeGreeting();
    if (!homeDataCache.greeting) loadHeaderGreeting();
    if (!homeDataCache.tunggakan) loadHomeTunggakan();
    if (!homeDataCache.fasum) loadHomeFasum();
    if (!homeDataCache.info) loadHomeInfo();
    if (!homeDataCache.contact) preloadContactData();
    if (!homeDataCache.security) preloadSecurityContacts();
  }

function loadHeaderGreeting() {
  var greetEl = document.getElementById('headerGreeting');
  var textEl  = document.getElementById('headerGreetingText');
  if (!greetEl || !textEl) return;

  gasGet_('getActiveGreeting')
    .then(function(res) {
      if (!res || !res.success || !res.text) return;
      var greetings = Array.isArray(res.texts) ? res.texts : [res.text];
      homeDataCache.greeting = greetings;
      startGreetingRotation_(greetings, textEl, greetEl);
    })
    .catch(function() {});
}

var _greetingRotateTimer_ = null;

function startGreetingRotation_(greetings, textEl, greetEl) {
  if (!greetings || !greetings.length) return;

  if (_greetingRotateTimer_) {
    clearInterval(_greetingRotateTimer_);
    _greetingRotateTimer_ = null;
  }

  var idx = 0;

  function show(i) {
    textEl.style.opacity = '0';
    textEl.style.transform = 'translateY(4px)';
    textEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    setTimeout(function() {
      textEl.innerText = greetings[i];
      greetEl.classList.remove('hidden');
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
    }, 200);
  }

  show(0);

  if (greetings.length > 1) {
    _greetingRotateTimer_ = setInterval(function() {
      idx = (idx + 1) % greetings.length;
      show(idx);
    }, 5000);
  }
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
          card200.style.background  = rate200 ? 'rgba(67,160,71,0.06)' : '';
          card200.style.opacity     = rate200 ? '1' : '0.6';
          card200.style.borderTop   = rate200 ? '2px solid #43A047' : '';
          if (!document.getElementById('tarifBadge200') && rate200 && p200label) {
            var badge200 = document.createElement('span');
            badge200.id = 'tarifBadge200';
            badge200.style.cssText = 'display:inline-block;font-size:8px;font-weight:700;color:#43A047;background:rgba(67,160,71,0.12);border-radius:4px;padding:1px 5px;margin-left:5px;letter-spacing:0.03em;vertical-align:middle;';
            badge200.innerText = '✓ Tarif Anda';
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
          card175.style.background  = rate175 ? 'rgba(67,160,71,0.06)' : '';
          card175.style.opacity     = rate175 ? '1' : '0.6';
          card175.style.borderTop   = rate175 ? '2px solid #43A047' : '';
          if (!document.getElementById('tarifBadge175') && rate175 && p175label) {
            var badge175 = document.createElement('span');
            badge175.id = 'tarifBadge175';
            badge175.style.cssText = 'display:inline-block;font-size:8px;font-weight:700;color:#43A047;background:rgba(67,160,71,0.12);border-radius:4px;padding:1px 5px;margin-left:5px;letter-spacing:0.03em;vertical-align:middle;';
            badge175.innerText = '✓ Tarif Anda';
            p175label.appendChild(badge175);
          }
          if (isMultiBlok && blokLabel175 && !document.getElementById('tarifBlokLabel175') && p175label) {
            var blokSpan175 = document.createElement('span');
            blokSpan175.id = 'tarifBlokLabel175';
            blokSpan175.style.cssText = 'display:block;font-size:9px;color:#43A047;font-weight:600;margin-top:2px;';
            blokSpan175.innerText = blokLabel175;
            p175label.appendChild(blokSpan175);
          }
        }
        if (p200label) p200label.style.color = rate200 ? '#43A047' : '';
        if (p200nom)   p200nom.style.color   = rate200 ? '#43A047' : '';
        if (p175label) p175label.style.color = rate175 ? '#43A047' : '';
        if (p175nom)   p175nom.style.color   = rate175 ? '#43A047' : '';
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
  if (s === 'normal')      return { dot: 'bg-green-400',  text: 'text-green-600',  label: 'Normal',      cardBg: 'bg-green-50',  cardBorder: 'border-green-100', iconBg: 'bg-green-100',  iconColor: 'text-green-600'  };
  if (s === 'maintenance') return { dot: 'bg-yellow-400', text: 'text-yellow-600', label: 'Maintenance', cardBg: 'bg-yellow-50', cardBorder: 'border-yellow-100',iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' };
  return                          { dot: 'bg-red-400',    text: 'text-red-600',    label: status || 'Gangguan', cardBg: 'bg-red-50', cardBorder: 'border-red-100', iconBg: 'bg-red-100', iconColor: 'text-red-500' };
}

function loadHomeFasum() {
  const el = document.getElementById('homeFasumList');
  if (!el) return;

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
  return '<div class="rounded-2xl overflow-hidden border ' + st.cardBorder + ' flex flex-col">' +
    // TOP: icon area
    '<div class="' + st.cardBg + ' px-3 pt-3 pb-4 flex flex-col items-center gap-2 flex-1">' +
      '<div class="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ' + st.iconBg + '">' +
        '<svg class="w-5 h-5 ' + st.iconColor + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
          ico +
        '</svg>' +
      '</div>' +
      '<p class="text-[11px] font-semibold text-gray-800 leading-tight text-center line-clamp-2">' + f.nama + '</p>' +
    '</div>' +
    // BOTTOM: status strip rata bawah
    '<div class="flex items-center justify-center gap-1 py-1.5 bg-white border-t ' + st.cardBorder + '">' +
      '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0 ' + st.dot + '"></div>' +
      '<span class="text-[10px] font-semibold ' + st.text + '">' + st.label + '</span>' +
    '</div>' +
  '</div>';
}

function renderFasumList(showAll) {
  var el  = document.getElementById('homeFasumList');
  var res = homeDataCache.fasum;
  if (!el || !res || !res.data) return;

  // Grid cols: 3 jika ≤6, 2 jika >6 tapi genap, 3 default
  el.className = 'grid grid-cols-3 gap-2 px-4 pb-4';

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
          rateByMonth: wargaRateByMonth,
          defaultRate: cachedRate
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
      var hp = String(c.noHp || '').replace(/\D/g, '');
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
  var otpStep   = document.getElementById('sayaStepOTP');
  var emailStep = document.getElementById('sayaStepEmail');
  otpStep.style.opacity = '0';
  otpStep.style.transform = 'translateY(6px)';
  otpStep.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  setTimeout(function() {
    otpStep.classList.add('hidden');
    otpStep.style.opacity = '';
    otpStep.style.transform = '';
    emailStep.classList.remove('hidden');
    emailStep.classList.add('saya-step');
    setTimeout(function() {
      emailStep.classList.remove('saya-step');
    }, 300);
  }, 180);
}

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
function openExplore() {
  var explorePage = document.getElementById('explorePage');
  var alreadyActive = explorePage && explorePage.classList.contains('active');

  switchPage('explorePage');
  setActiveNavById('navService');
  refreshAdminExploreSection();
  if (!history.state || !history.state.explore) {
    history.pushState({ explore: true }, '');
  }

  // Jika sudah di explore → scroll to top
  var exploreScroll = document.querySelector('#explorePage .flex-1.overflow-y-auto');
  if (exploreScroll) exploreScroll.scrollTop = 0;
}

/* ============================================================
   ADMIN CRUD — INFO & FASUM
   ============================================================ */

var _infoCRUDCache = null;
var _fasumCRUDCache = null;

// ===== SHOW/HIDE ADMIN SECTION =====
function refreshAdminExploreSection(forceRefresh) {
  var sec = document.getElementById('adminExploreSection');
  if (!sec) return;
  if (currentUser && currentUser.role === 'admin') {
    sec.classList.remove('hidden');
    if (forceRefresh) {
      _infoCRUDCache = null;
      _fasumCRUDCache = null;
    }
    loadAdminInfoPreview();
    loadAdminFasumPreview();
  } else {
    sec.classList.add('hidden');
  }
}

function loadAdminInfoPreview() {
  var el = document.getElementById('adminInfoPreviewList');
  if (!el) return;
  // Gunakan cache jika ada
  if (_infoCRUDCache) {
    renderAdminInfoPreview_(_infoCRUDCache);
    return;
  }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetInfoData')
    .then(function(res) { _infoCRUDCache = res; renderAdminInfoPreview_(res); })
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
  var STATUS_COLOR = { normal: 'bg-green-50 text-green-600', maintenance: 'bg-yellow-50 text-yellow-600' };
  el.innerHTML = res.data.slice(0, 3).map(function(d) {
    var color = STATUS_COLOR[d.status.toLowerCase()] || 'bg-red-50 text-red-500';
    return '<div class="flex items-center justify-between py-1.5">' +
      '<span class="text-xs text-gray-700 truncate flex-1 pr-2">' + d.nama + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full ' + color + ' font-medium flex-shrink-0">' + d.status + '</span>' +
    '</div>';
  }).join('') + (res.data.length > 3 ? '<p class="text-xs text-gray-400 pt-1">+' + (res.data.length - 3) + ' lainnya</p>' : '');
}

function loadAdminFasumPreview() {
  var el = document.getElementById('adminFasumPreviewList');
  if (!el) return;
  if (_fasumCRUDCache) {
    renderAdminFasumPreview_(_fasumCRUDCache);
    return;
  }
  el.innerHTML = '<div class="space-y-2 py-1">' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-3/4"></div>' +
    '<div class="h-5 rounded-lg bg-gray-100 animate-pulse w-1/2"></div>' +
    '</div>';
  gasGet_('adminGetFasumData')
    .then(function(res) { _fasumCRUDCache = res; renderAdminFasumPreview_(res); })
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
      gasGet_('adminGetInfoData')
        .then(function(res) {
          _infoCRUDCache = res;
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
        gasGet_('adminGetInfoData')
          .then(function(res2) {
            _infoCRUDCache = res2;
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
        gasGet_('adminGetFasumData')
          .then(function(res) {
            _fasumCRUDCache = res;
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
      gasGet_('adminGetFasumData')
        .then(function(res2) {
          _fasumCRUDCache = res2;
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
   FORM MUDIK
   ============================================================ */
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
      '<svg style="width:24px;height:24px;animation:spin 1s linear infinite;" viewBox="0 0 24 24" fill="none">' +
        '<circle cx="12" cy="12" r="10" stroke="#e5e7eb" stroke-width="3"/>' +
        '<path d="M12 2a10 10 0 0 1 10 10" stroke="#43A047" stroke-width="3"/>' +
      '</svg>' +
      '<p style="font-size:13px;color:#6b7280;font-family:sans-serif;">Memuat daftar laporan...</p>';
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
    '<p style="font-size:13px;color:#6b7280;font-family:sans-serif;">Memuat laporan...</p>';

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
  div.style.cssText = 'position:absolute;inset:0;background:#f9fafb;overflow-y:auto;z-index:10;';

  var isPdf = function(mime) {
    return mime && mime.toLowerCase().includes('pdf');
  };

  var html =
    '<div style="padding:16px;">' +
      '<p style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px 4px;">' +
        files.length + ' Dokumen Tersedia' +
      '</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">';

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
         'style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;' +
                'background:#ffffff;border-radius:16px;' +
                'padding:12px;border:1px solid #f3f4f6;' +
                'box-shadow:0 1px 3px rgba(0,0,0,0.06);">' +
        icon +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:13px;font-weight:600;color:#111827;margin:0 0 2px 0;' +
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            f.name +
          '</p>' +
          '<p style="font-size:11px;color:#9ca3af;margin:0;">' + f.date + '</p>' +
        '</div>' +
        '<svg width="16" height="16" fill="none" stroke="#d1d5db" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;">' +
          '<path d="M9 18l6-6-6-6"/>' +
        '</svg>' +
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
        '<p style="font-size:13px;color:#6b7280;font-family:sans-serif;">Memuat daftar laporan...</p>';
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
    '<p style="font-size:13px;color:#6b7280;font-family:sans-serif;">Memuat dokumen...</p>';
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
