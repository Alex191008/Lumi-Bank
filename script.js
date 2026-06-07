let sessionMode = 'staff';
let currentUserAccountId = null;
let currentClienteId = null;
const CLIENT_STORAGE_KEY = 'lumibank_clienti';
const CLIENT_SESSION_KEY = 'lumibank_currentClienteId';

// Inizializzazione al caricamento della pagina
window.addEventListener('DOMContentLoaded', function() {
    initDB().catch(err => console.error('Errore inizializzazione DB:', err));
    if (typeof emailjs !== 'undefined') {
        emailjs.init('p6veAdpt1dHoroxMG');
    }
});

// ========== COMPONENTI CARD (OOP - No Repetition) ==========
class CardRenderer {
    static renderCliente(cliente, conti) {
        return `
            <div class="client-card">
                <div class="client-name-row">
                    <div class="client-avatar">👤</div>
                    <div class="client-info">
                        <h3 class="client-name">${cliente.nome} ${cliente.cognome}</h3>
                        <p class="client-email">${cliente.email}</p>
                    </div>
                </div>
                <div class="client-stats">
                    <div class="stat-item">
                        <span class="stat-label">Conti</span>
                        <span class="stat-value">${conti.length}</span>
                    </div>
                </div>
                <button class="btn-action btn-fullwidth" onclick="apriGestioneClienteModal('${cliente.id}')">Gestisci</button>
            </div>
        `;
    }

    static renderConto(conto, clickable = true) {
        const iconaTipo = conto.tipoConto === 'Canone Fisso' ? '💳' : 
                          conto.tipoConto === 'Senza Canone' ? '🍃' : '📈';
        const clickHandler = clickable ? `onclick="apriDettagliConto('${conto.id}')"` : '';
        return `
            <div class="account-card" ${clickHandler}>
                <div class="account-header">
                    <span class="account-icon">${iconaTipo}</span>
                    <span class="account-type">${conto.tipoConto}</span>
                </div>
                <div class="account-iban">${conto.iban}</div>
                <div class="account-titolari">${(conto.titolariString || '').substring(0, 30)}</div>
                <div class="account-balance">€ ${formatCurrency(conto.saldo)}</div>
            </div>
        `;
    }

    static renderPrestito(prestito) {
        const cliente = trovaClientePerId(prestito.clienteId);
        const nome = cliente ? `${cliente.nome} ${cliente.cognome}` : 'Cliente sconosciuto';
        const statoClass = prestito.statoPrestito === 'Accettato' ? 'status-accepted' : prestito.statoPrestito === 'Respinto' ? 'status-rejected' : 'status-pending';
        return `
            <div class="account-card prestito-card">
                <div class="account-header">
                    <span class="account-icon">🏦</span>
                    <span class="account-type">${prestito.tipoPrestito}</span>
                </div>
                <div class="account-iban"><strong>${nome}</strong></div>
                <div class="account-titolari">Importo: € ${formatCurrency(prestito.importo)}</div>
                <div class="account-balance">Rata: € ${formatCurrency(prestito.rata)}</div>
                <div class="loan-detail"><strong>Motivo:</strong> ${prestito.motivo}</div>
                <div class="loan-status ${statoClass}" style="margin-top: 10px;">${prestito.statoPrestito}</div>
            </div>
        `;
    }

    static renderRichiestaConto(r) {
        const cliente = trovaClientePerId(r.clienteId);
        const nomeCliente = cliente ? `${cliente.nome} ${cliente.cognome}` : 'Cliente sconosciuto';
        const statoClass = r.stato === 'Accettato' ? 'status-accepted' : r.stato === 'Rifiutato' ? 'status-rejected' : 'status-pending';
        const btnStyle = 'flex:1; padding:10px; font-size:0.85rem; font-weight:bold; margin-top:0;';
        const azioni = r.stato === 'In attesa' ? `
            <div style="display:flex; gap:8px; margin-top:10px;">
                <button class="btn-action" style="${btnStyle}" onclick="accettaRichiestaConto('${r.id}')">✓ Accetta</button>
                <button class="btn-danger" style="${btnStyle}" onclick="rifiutaRichiestaConto('${r.id}')">✕ Rifiuta</button>
            </div>` : '';
        return `
            <div class="account-card">
                <div class="account-header">
                    <span class="account-icon">📋</span>
                    <span class="account-type">Richiesta Apertura Conto</span>
                </div>
                <div class="account-iban"><strong>${nomeCliente}</strong></div>
                <div class="account-titolari">Tipo: ${r.tipoConto}</div>
                <div class="account-titolari">Titolare: ${r.dati.nome} ${r.dati.cognome} — CF: ${r.dati.cf}</div>
                <div class="account-titolari">Data: ${r.dataRichiesta}</div>
                <div class="loan-status ${statoClass}" style="margin-top:8px;">${r.stato}</div>
                ${azioni}
            </div>`;
    }

    static renderMovimento(mov, contoIban = '') {
        const colore = mov.tipo === 'Entrata' ? 'color: #27ae60' : 'color: #e74c3c';
        const itemClass = mov.tipo === 'Uscita' ? 'movimento-item uscita' : 'movimento-item';
        const simbolo = mov.tipo === 'Entrata' ? '+' : '-';
        return `
            <div class="${itemClass}">
                <div class="movimento-info">
                    <div><strong>${mov.tipoOperazione}</strong></div>
                    ${mov.categoria ? `<small style="color:#888;">${mov.categoria}</small>` : ''}
                    <small>${mov.dataContabile} | ${mov.causale}</small>
                    ${contoIban ? `<small style="color: #999; display: block; margin-top: 4px;">IBAN: ${contoIban}</small>` : ''}
                </div>
                <div class="movimento-amount" style="${colore}">
                    ${simbolo} € ${formatCurrency(mov.importo)}
                </div>
            </div>
        `;
    }

    static renderToElement(elementId, items, renderFn) {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.innerHTML = items.map(item => renderFn(item)).join('');
    }
}

// ========== STATISTICHE DASHBOARD ==========
class StatsRenderer {
    static getDashboardStats() {
        const clienti = ottieniClienti();
        const conti = ottieni_conti();
        const prestiti = ottieniPrestiti();
        const richiesteConto = ottieniRichiesteConto();

        const prestitiPending = prestiti.filter(p => p.statoPrestito === 'Richiesto').length;
        const richiesteContoPending = richiesteConto.filter(r => r.stato === 'In attesa').length;

        return { clienti, conti, prestiti, prestitiPending, richiesteContoPending };
    }

    static renderStatsBar() {
        const stats = this.getDashboardStats();
        return `
            <div class="stats-container">
                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <div class="stat-content">
                        <span class="stat-label">Clienti</span>
                        <span class="stat-number">${stats.clienti.length}</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💳</div>
                    <div class="stat-content">
                        <span class="stat-label">Conti</span>
                        <span class="stat-number">${stats.conti.length}</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⏳</div>
                    <div class="stat-content">
                        <span class="stat-label">Prestiti in attesa</span>
                        <span class="stat-number pending">${stats.prestitiPending}</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">📋</div>
                    <div class="stat-content">
                        <span class="stat-label">Richieste conto</span>
                        <span class="stat-number pending">${stats.richiesteContoPending}</span>
                    </div>
                </div>
            </div>
        `;
    }
}

function hashPassword(password) {
    return btoa(unescape(encodeURIComponent(password)));
}

function formatCurrency(value) {
    const number = Number(value);
    if (Number.isNaN(number)) return '0,00';
    return number.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ottieniClienti() {
    const dati = localStorage.getItem(CLIENT_STORAGE_KEY);
    if (!dati) return [];
    try {
        const clienti = JSON.parse(dati);
        return Array.isArray(clienti) ? clienti : [];
    } catch {
        return [];
    }
}

function salvaClienti(clienti) {
    localStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(clienti));
}

function trovaClientePerEmail(email) {
    if (!email) return null;
    const clienti = ottieniClienti();
    return clienti.find(c => c.email && c.email.toLowerCase() === String(email).toLowerCase());
}

const PRESTITI_STORAGE_KEY = 'lumibank_prestiti';
const RICHIESTE_CONTO_KEY = 'lumibank_richieste_conto';

function ottieniRichiesteConto() {
    const dati = localStorage.getItem(RICHIESTE_CONTO_KEY);
    if (!dati) return [];
    try { const r = JSON.parse(dati); return Array.isArray(r) ? r : []; } catch { return []; }
}

function salvaRichiesteConto(richieste) {
    localStorage.setItem(RICHIESTE_CONTO_KEY, JSON.stringify(richieste));
}

function aggiungiRichiestaConto(richiesta) {
    const richieste = ottieniRichiesteConto();
    richieste.push(richiesta);
    salvaRichiesteConto(richieste);
}

function ottieniPrestiti() {
    const dati = localStorage.getItem(PRESTITI_STORAGE_KEY);
    if (!dati) return [];
    try {
        const prestiti = JSON.parse(dati);
        return Array.isArray(prestiti) ? prestiti : [];
    } catch {
        return [];
    }
}

function salvaPrestiti(prestiti) {
    localStorage.setItem(PRESTITI_STORAGE_KEY, JSON.stringify(prestiti));
}

function aggiungiPrestito(prestito) {
    const prestiti = ottieniPrestiti();
    prestiti.push(prestito);
    salvaPrestiti(prestiti);
}

function trovaPrestitoPerId(id) {
    if (!id) return null;
    return ottieniPrestiti().find(p => p.id === id);
}

function trovaPrestitiPerCliente(clienteId) {
    if (!clienteId) return [];
    return ottieniPrestiti().filter(p => p.clienteId === clienteId);
}

function cercaPrestitiPerNome(query) {
    const prestiti = ottieniPrestiti();
    const tokens = query.toLowerCase().trim();
    if (!tokens) return [];
    return prestiti.filter(prestito => {
        const cliente = trovaClientePerId(prestito.clienteId);
        const nomeCliente = cliente ? `${cliente.nome} ${cliente.cognome}`.toLowerCase() : '';
        return nomeCliente.includes(tokens) || (prestito.motivo || '').toLowerCase().includes(tokens);
    });
}

function trovaClientePerId(id) {
    if (!id) return null;
    return ottieniClienti().find(c => c.id === id);
}

function mostraLoginCliente() {
    document.getElementById('clientLoginFields').classList.remove('hidden');
    document.getElementById('clientRegisterFields').classList.add('hidden');
}

function mostraRegistrazioneCliente() {
    document.getElementById('clientLoginFields').classList.add('hidden');
    document.getElementById('clientRegisterFields').classList.remove('hidden');
}

function impostaModalita(mode) {
    sessionMode = mode;
    document.getElementById('modeStaffBtn').classList.toggle('active', mode === 'staff');
    document.getElementById('modeClienteBtn').classList.toggle('active', mode === 'cliente');
    document.getElementById('loginSubtitle').textContent = mode === 'staff' ? 'Sistema Bancario' : 'Accesso cliente';
    document.getElementById('loginHint').textContent = mode === 'staff' ? 'Accedi come amministratore' : 'Accedi o registrati con la tua email';
    document.getElementById('staffLoginFields').classList.toggle('hidden', mode === 'cliente');
    document.getElementById('clientLoginCta').classList.toggle('hidden', mode !== 'cliente');
    if (mode === 'cliente') {
        mostraLoginCliente();
    }
}

function entraNelSistema(logout = true) {
    if (logout) {
        const user = document.getElementById('username').value;
        const pass = document.getElementById('password').value;
        
        if (user === "admin" && pass === "1234") {
            sessionMode = 'staff';
            currentUserAccountId = null;
            currentClienteId = null;
            sessionStorage.removeItem('lumibank_sessionMode');
            sessionStorage.removeItem('lumibank_currentAccountId');
            sessionStorage.removeItem(CLIENT_SESSION_KEY);
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            aggiornaModalitaApp();
            caricaDashboard();
        } else {
            alert("Credenziali errate!");
        }
    } else {
        sessionMode = 'staff';
        currentUserAccountId = null;
        currentClienteId = null;
        sessionStorage.removeItem('lumibank_sessionMode');
        sessionStorage.removeItem('lumibank_currentAccountId');
        sessionStorage.removeItem(CLIENT_SESSION_KEY);
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        impostaModalita('staff');
    }
}

function entraComeCliente() {
    currentClienteId = sessionStorage.getItem(CLIENT_SESSION_KEY);
    if (!currentClienteId) {
        impostaModalita('cliente');
        return;
    }
    sessionMode = 'cliente';
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    aggiornaModalitaApp();
    mostraSezione('dashboard');
}

function confermaLogout() {
    if (!confirm('Sei sicuro di voler effettuare il logout?')) {
        return;
    }
    entraNelSistema(false);
}

function caricaImpostazioniAccount() {
    const cliente = trovaClientePerId(currentClienteId);
    if (!cliente) return;

    document.getElementById('settingsNome').textContent = `${cliente.nome} ${cliente.cognome}`;
    document.getElementById('settingsEmail').textContent = cliente.email;
    document.getElementById('settingsRegistrato').textContent = cliente.registratoIl;
    const conti = ottieni_conti().filter(c => c.clienteId === cliente.id);
    document.getElementById('settingsContiCount').textContent = conti.length;
}

function eliminaAccountCliente() {
    if (!currentClienteId) {
        alert('Nessun account cliente attivo.');
        return;
    }

    if (!confirm('⚠️ Sei sicuro di voler eliminare il tuo account? Tutti i conti e le richieste verranno rimossi definitivamente.')) {
        return;
    }

    const clienteId = currentClienteId;
    const clienti = ottieniClienti().filter(c => c.id !== clienteId);
    salvaClienti(clienti);

    const conti = ottieni_conti().filter(c => c.clienteId !== clienteId);
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    salvaContiIndexedDB(conti).catch(console.error);

    const prestiti = ottieniPrestiti().filter(p => p.clienteId !== clienteId);
    salvaPrestiti(prestiti);

    currentClienteId = null;
    sessionStorage.removeItem(CLIENT_SESSION_KEY);
    sessionStorage.removeItem('lumibank_sessionMode');

    alert('✅ Account eliminato con successo. Verrai disconnesso.');
    entraNelSistema(false);
}

function registraCliente() {
    const email = document.getElementById('clientEmailReg').value.trim().toLowerCase();
    const nome = document.getElementById('clientNomeReg').value.trim();
    const cognome = document.getElementById('clientCognomeReg').value.trim();
    const password = document.getElementById('clientPasswordReg').value;
    const passwordConfirm = document.getElementById('clientPasswordConfirmReg').value;

    if (!email || !nome || !cognome || !password || !passwordConfirm) {
        alert('Compila tutti i campi per la registrazione.');
        return;
    }
    if (!email.includes('@')) {
        alert('Inserisci un indirizzo email valido.');
        return;
    }
    if (password.length < 6) {
        alert('La password deve contenere almeno 6 caratteri.');
        return;
    }
    if (password !== passwordConfirm) {
        alert('Le password non corrispondono.');
        return;
    }
    if (trovaClientePerEmail(email)) {
        alert('Esiste già un account con questa email.');
        return;
    }

    const nuovoCliente = {
        id: 'CLI_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        email,
        nome,
        cognome,
        passwordHash: hashPassword(password),
        registratoIl: new Date().toLocaleString('it-IT')
    };

    const clienti = ottieniClienti();
    clienti.push(nuovoCliente);
    salvaClienti(clienti);
    inviaEmailRegistrazioneCliente(nuovoCliente);

    currentClienteId = nuovoCliente.id;
    sessionStorage.setItem(CLIENT_SESSION_KEY, currentClienteId);
    sessionStorage.setItem('lumibank_sessionMode', 'cliente');
    sessionMode = 'cliente';

    document.getElementById('clientEmailReg').value = '';
    document.getElementById('clientNomeReg').value = '';
    document.getElementById('clientCognomeReg').value = '';
    document.getElementById('clientPasswordReg').value = '';
    document.getElementById('clientPasswordConfirmReg').value = '';

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    aggiornaModalitaApp();
    caricaDashboard();
    mostraSezione('dashboard');
    alert('✅ Registrazione completata. Benvenuto, ' + nome + '!');
}

function loginCliente() {
    const email = document.getElementById('clientEmailLogin').value.trim().toLowerCase();
    const password = document.getElementById('clientPasswordLogin').value;

    if (!email || !password) {
        alert('Inserisci email e password.');
        return;
    }

    const cliente = trovaClientePerEmail(email);
    if (!cliente || cliente.passwordHash !== hashPassword(password)) {
        alert('Credenziali non valide.');
        return;
    }

    currentClienteId = cliente.id;
    sessionStorage.setItem(CLIENT_SESSION_KEY, currentClienteId);
    sessionStorage.setItem('lumibank_sessionMode', 'cliente');
    sessionMode = 'cliente';

    document.getElementById('clientEmailLogin').value = '';
    document.getElementById('clientPasswordLogin').value = '';

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    aggiornaModalitaApp();
    mostraSezione('dashboard');
}

function logoutCliente() {
    currentClienteId = null;
    sessionMode = 'staff';
    sessionStorage.removeItem(CLIENT_SESSION_KEY);
    sessionStorage.removeItem('lumibank_sessionMode');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    impostaModalita('staff');
}

function aggiornaModalitaApp() {
    const userModeLabel = document.getElementById('userModeLabel');
    if (userModeLabel) {
        if (sessionMode === 'staff') {
            userModeLabel.textContent = 'Modalità: Operatore';
        } else {
            const cliente = trovaClientePerId(currentClienteId);
            userModeLabel.textContent = cliente ? `Cliente: ${cliente.nome} ${cliente.cognome}` : 'Modalità: Cliente';
        }
    }
    const accountSettingsNavBtn = document.getElementById('accountSettingsNavBtn');
    if (accountSettingsNavBtn) {
        accountSettingsNavBtn.style.display = sessionMode === 'cliente' ? 'inline-block' : 'none';
    }
    const operazioniNavBtn = document.getElementById('operazioniNavBtn');
    if (operazioniNavBtn) {
        operazioniNavBtn.style.display = sessionMode === 'cliente' ? 'inline-block' : 'none';
    }
    const manageUsersBtn = document.getElementById('manageUsersBtn');
    if (manageUsersBtn) {
        manageUsersBtn.style.display = sessionMode === 'staff' ? 'inline-block' : 'none';
    }
    const nuovoContoNavBtn = document.getElementById('nuovoContoNavBtn');
    if (nuovoContoNavBtn) {
        nuovoContoNavBtn.style.display = sessionMode === 'cliente' ? 'inline-block' : 'none';
    }
    const btnCrea = document.getElementById('btnCreazioneConto');
    if (btnCrea) {
        btnCrea.textContent = sessionMode === 'staff' ? '✓ ATTIVA CONTO' : 'INVIA RICHIESTA';
    }
}

// ========== NAVIGAZIONE ==========
function mostraSezione(sezione) {
    // Controllo di accesso: staff-only sections
    if (['gestioneAccount'].includes(sezione) && sessionMode !== 'staff') {
        alert('❌ Accesso negato. Solo l\'operatore può accedere a questa sezione.');
        return;
    }
    
    // Controllo di accesso: cliente-only sections
    if (sezione === 'nuovoConto' && sessionMode !== 'cliente') {
        alert('❌ Accesso negato. Solo i clienti possono creare nuovi conti.');
        return;
    }
    
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    if (sezione === 'dashboard') {
        document.getElementById('dashboardSection').classList.remove('hidden');
        caricaDashboard();
    } else if (sezione === 'nuovoConto') {
        document.getElementById('nuovoContoSection').classList.remove('hidden');
        prefillNuovoContoConCliente();
    } else if (sezione === 'operazioni') {
        document.getElementById('operazioniSection').classList.remove('hidden');
        caricaOperazioniSection();
    } else if (sezione === 'gestioneAccount') {
        document.getElementById('gestioneAccountSection').classList.remove('hidden');
        caricaGestioneConti();
    } else if (sezione === 'impostazioniAccount') {
        document.getElementById('accountSettingsSection').classList.remove('hidden');
        caricaImpostazioniAccount();
    } else if (sezione === 'prestiti') {
        document.getElementById('prestitiSection').classList.remove('hidden');
        caricaPrestitiSection();
    }
    
    if (event && event.target) {
        event.target.classList.add('active');
    }
    aggiornaModalitaApp();
}

function prefillNuovoContoConCliente() {
    const nomeInput = document.getElementById('nomeUtente');
    const cognomeInput = document.getElementById('cognomeUtente');
    if (!nomeInput || !cognomeInput) return;
    if (sessionMode === 'cliente' && currentClienteId) {
        const cliente = trovaClientePerId(currentClienteId);
        if (cliente) {
            nomeInput.value = cliente.nome || '';
            cognomeInput.value = cliente.cognome || '';
            nomeInput.disabled = true;
            cognomeInput.disabled = true;
        }
    } else {
        nomeInput.value = '';
        cognomeInput.value = '';
        nomeInput.disabled = false;
        cognomeInput.disabled = false;
    }
}

function caricaOperazioniSection() {
    const select = document.getElementById('operazioniAccountSelect');
    const saldoText = document.getElementById('operazioniSaldo');
    const movimentiDiv = document.getElementById('operazioniRecentiMovimenti');
    if (!select || !saldoText || !movimentiDiv) return;

    select.innerHTML = '<option value="">Seleziona un conto</option>';
    const conti = ottieni_conti().filter(c => c.clienteId === currentClienteId);
    if (conti.length === 0) {
        saldoText.textContent = '€ 0,00';
        movimentiDiv.innerHTML = '<p class="empty-text">Non hai conti disponibili. Crea un conto prima di registrare movimenti.</p>';
        return;
    }

    conti.forEach(conto => {
        select.innerHTML += `<option value="${conto.id}">${conto.iban} - € ${formatCurrency(conto.saldo)}</option>`;
    });

    if (conti.length === 1) {
        select.selectedIndex = 1;
        aggiornaOperazioniAccountInfo();
    } else {
        select.selectedIndex = 0;
        saldoText.textContent = '€ 0,00';
        movimentiDiv.innerHTML = '<p class="empty-text">Seleziona un conto per vedere gli ultimi movimenti.</p>';
    }
}

function aggiornaOperazioniAccountInfo() {
    const select = document.getElementById('operazioniAccountSelect');
    const saldoText = document.getElementById('operazioniSaldo');
    const movimentiDiv = document.getElementById('operazioniRecentiMovimenti');
    if (!select || !saldoText || !movimentiDiv) return;

    const contoId = select.value;
    if (!contoId) {
        saldoText.textContent = '€ 0,00';
        movimentiDiv.innerHTML = '<p class="empty-text">Seleziona un conto per vedere gli ultimi movimenti.</p>';
        const btnScarica = document.getElementById('btnScaricaEstratto');
        if (btnScarica) btnScarica.disabled = true;
        return;
    }

    const conto = ottieni_conti().find(c => c.id === contoId);
    if (!conto) return;

    // Aggiorna le label del select in base al tipo di conto
    const tipoSelect = document.getElementById('tipoMovimentoOperazioni');
    if (tipoSelect) {
        if (conto.tipoConto === 'Deposito') {
            tipoSelect.options[0].text = 'Versamento';
            tipoSelect.options[1].text = 'Prelievo';
            document.getElementById('tipoUscitaContainer').style.display = 'none';
        } else {
            tipoSelect.options[0].text = 'Entrata';
            tipoSelect.options[1].text = 'Uscita';
            toggleTipoUscita();
        }
    }

    saldoText.textContent = `€ ${formatCurrency(conto.saldo)}`;
    const btnScarica = document.getElementById('btnScaricaEstratto');
    if (btnScarica) btnScarica.disabled = false;
    if (!conto.movimenti || conto.movimenti.length === 0) {
        movimentiDiv.innerHTML = '<p class="empty-text">Nessun movimento ancora.</p>';
        return;
    }

    movimentiDiv.innerHTML = '';
    conto.movimenti.slice(0, 10).forEach(mov => {
        const colore = mov.tipo === 'Entrata' ? 'color: #27ae60' : 'color: #e74c3c';
        const simbolo = mov.tipo === 'Entrata' ? '+' : '-';
        const itemClass = mov.tipo === 'Uscita' ? 'movimento-item uscita' : 'movimento-item';
        movimentiDiv.insertAdjacentHTML('beforeend', `
            <div class="${itemClass}">
                <div class="movimento-info">
                    <div><strong>${mov.tipoOperazione}</strong></div>
                    ${mov.categoria ? `<small style="color:#888;">${mov.categoria}</small>` : ''}
                    <small>${mov.dataContabile} | ${mov.causale}</small>
                </div>
                <div class="movimento-amount" style="${colore}">
                    ${simbolo} € ${formatCurrency(mov.importo)}
                </div>
            </div>
        `);
    });
}

function scaricaEstrattoConto() {
    const contoId = document.getElementById('operazioniAccountSelect').value;
    if (!contoId) return;
    const conto = ottieni_conti().find(c => c.id === contoId);
    if (!conto) return;

    const righe = [
        ['LumiBank - Estratto Conto'],
        [`IBAN: ${conto.iban}`],
        [`Tipo conto: ${conto.tipoConto}`],
        [`Titolare/i: ${conto.titolariString}`],
        [`Saldo attuale: € ${formatCurrency(conto.saldo)}`],
        [`Estratto generato il: ${new Date().toLocaleDateString('it-IT')}`],
        [],
        ['Data', 'Tipo', 'Categoria', 'Causale', 'Importo (€)']
    ];

    if (!conto.movimenti || conto.movimenti.length === 0) {
        righe.push(['Nessun movimento registrato']);
    } else {
        conto.movimenti.forEach(m => {
            const segno = m.tipo === 'Entrata' ? '+' : '-';
            righe.push([
                m.dataContabile,
                m.tipoOperazione,
                m.categoria || '',
                m.causale || '',
                `${segno}${formatCurrency(m.importo)}`
            ]);
        });
    }

    const csv = righe.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EstrattoContoLumiBank_${conto.iban}_${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function toggleTipoUscita() {
    const tipo = document.getElementById('tipoMovimentoOperazioni').value;
    const contoId = document.getElementById('operazioniAccountSelect').value;
    const conto = contoId ? ottieni_conti().find(c => c.id === contoId) : null;
    const isDeposito = conto && conto.tipoConto === 'Deposito';
    document.getElementById('tipoUscitaContainer').style.display = (!isDeposito && tipo === 'Uscita') ? '' : 'none';
}

function registraMovimentoOperazioni() {
    const select = document.getElementById('operazioniAccountSelect');
    const tipo = document.getElementById('tipoMovimentoOperazioni').value;
    const tipoUscita = tipo === 'Uscita' ? document.getElementById('tipoUscita').value : null;
    const importo = parseFloat(document.getElementById('importoMovimentoOperazioni').value);
    const causale = document.getElementById('causaleMovimentoOperazioni').value.trim() || (tipo === 'Entrata' ? 'Entrata registrata' : tipoUscita);

    if (!select || !tipo || !importo || importo <= 0) {
        alert('Compila tutti i campi e inserisci un importo valido.');
        return;
    }

    const contoId = select.value;
    if (!contoId) {
        alert('Seleziona un conto.');
        return;
    }

    const conti = ottieni_conti();
    const conto = conti.find(c => c.id === contoId);
    if (!conto) {
        alert('Conto non trovato.');
        return;
    }

    if (tipo === 'Entrata' && importo > 10000000) {
        alert('❌ Il limite massimo per una singola entrata è € 10.000.000,00.');
        return;
    }

    if (tipo === 'Uscita' && conto.saldo < importo) {
        alert('Saldo insufficiente per registrare questa uscita.');
        return;
    }

    if (tipo === 'Entrata') {
        conto.saldo += importo;
    } else {
        conto.saldo -= importo;
    }

    const isDeposito = conto.tipoConto === 'Deposito';
    const tipoOpNome = isDeposito
        ? (tipo === 'Entrata' ? 'Versamento' : 'Prelievo')
        : (tipoUscita ? `${tipo} ${tipoUscita}` : tipo);
    const causaleFinale = causale || (isDeposito ? tipoOpNome : (tipoUscita || tipo));
    conto.registraMovimento(tipo, importo, tipoOpNome, causaleFinale, isDeposito ? '' : (tipoUscita || ''));

    // Aggiorna la sezione operazioni e lo storico movimenti
    caricaOperazioniSection();
    const nuovoSelect = document.getElementById('operazioniAccountSelect');
    if (nuovoSelect) {
        nuovoSelect.value = contoId;
        aggiornaOperazioniAccountInfo();
    }

    // Aggiorna la dashboard se visibile
    if (!document.getElementById('dashboardSection').classList.contains('hidden')) {
        caricaDashboard();
    }

    // Se il modal conto è aperto e mostra lo stesso conto, aggiorna anche quello
    if (contoSelezionato && contoSelezionato.id === contoId) {
        contoSelezionato = conto;
        document.getElementById('modalSaldo').textContent = `€ ${formatCurrency(conto.saldo)}`;
        caricaMovimenti();
    }

    document.getElementById('importoMovimentoOperazioni').value = '';
    document.getElementById('causaleMovimentoOperazioni').value = '';

    // Invia email di notifica al cliente
    const cliente = trovaClientePerId(currentClienteId);
    if (cliente) inviaEmailMovimento(cliente, tipoOpNome, importo);

    alert(`✓ Movimento ${tipo.toLowerCase()} registrato correttamente.`);
}

function cambiaTab(tabName, button) {
    document.querySelectorAll('.tab-content').forEach(t => {
        t.classList.add('hidden');
        t.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const targetTab = document.getElementById(tabName);
    if (targetTab) {
        targetTab.classList.remove('hidden');
        targetTab.classList.add('active');
    }
    if (button) {
        button.classList.add('active');
    }
}

// ========== CLASSE CONTO BANCARIO ==========
class Conto {
    constructor(dati, tipo, tassoInteresse = null) {
        this.id = this.generaID();
        this.dataCreazioine = new Date().toLocaleDateString('it-IT');
        
        // Titolari
        this.titolari = [
            {
                nome: dati.nome,
                cognome: dati.cognome,
                cf: dati.cf.toUpperCase(),
                dataNascita: dati.dataNascita,
                luogo: dati.luogo,
                provincia: dati.provincia.toUpperCase(),
                contatti: dati.contatti,
                indirizzo: dati.indirizzo
            }
        ];
        
        // Aggiunta cointestatari
        if (dati.cointestatari && dati.cointestatari.length > 0) {
            this.titolari.push(...dati.cointestatari.filter(c => c && c.nome && c.cognome));
        }
        
        // Proprietà per titolariString (necessaria per localStorage)
        this.titolariString = this.titolari.map(t => `${t.nome} ${t.cognome}`).join(', ');
        
        // Tipo e parametri
        this.tipoConto = tipo;
        this.iban = this.generaIBAN();
        this.saldo = 0;
        
        // Parametri specifici per tipo
        if (tipo === "Canone Fisso") {
            this.canone = 15.00;
            this.commissioni = 0;
        } else if (tipo === "Senza Canone") {
            this.canone = 0;
            this.commissioni = 3.00; // Per operazione in filiale
        } else if (tipo === "Deposito") {
            this.canone = 0;
            this.commissioni = 0;
            this.tassoInteresse = tassoInteresse || 1.5;
            this.ultimoCalcoloInteresse = new Date();
        }
        
        // Movimenti (ultimi 10)
        this.movimenti = [];
        
        // Interessi accumulati (per conto deposito)
        this.interessiAccumulati = 0;
    }
    
    generaID() {
        return 'ACC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    generaIBAN() {
        const banca = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
        const filiale = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
        const conto = String(Math.floor(Math.random() * 9999999999)).padStart(10, '0');
        return `IT60${banca}${filiale}${conto}`;
    }
    
    registraMovimento(tipo, importo, tipoOperazione, causale = '', categoria = '') {
        const movimento = {
            dataContabile: new Date().toLocaleDateString('it-IT'),
            dataValuta: new Date().toLocaleDateString('it-IT'),
            tipo: tipo,
            tipoOperazione: tipoOperazione,
            categoria: categoria,
            importo: importo,
            causale: causale,
            saldoFinale: this.saldo
        };
        
        this.movimenti.unshift(movimento);
        salvaConto(this);
    }
    
    calcolaInteressi() {
        if (this.tipoConto !== "Deposito") return;
        
        const oggi = new Date();
        const ultimoCalcolo = new Date(this.ultimoCalcoloInteresse);
        const giorni = Math.floor((oggi - ultimoCalcolo) / (1000 * 60 * 60 * 24));
        
        if (giorni >= 1) {
            const interesseGiornaliero = (this.saldo * this.tassoInteresse) / 36500;
            this.interessiAccumulati += interesseGiornaliero * giorni;
            this.ultimoCalcoloInteresse = oggi;
        }
    }
}

class Prestito {
    constructor(dati) {
        this.id = this.generaID();
        this.clienteId = dati.clienteId || null;
        this.dataRichiesta = new Date().toLocaleDateString('it-IT');
        this.importo = parseFloat(dati.importo) || 0;
        this.durata = parseInt(dati.durata, 10) || 0;
        this.tassoInteresse = parseFloat(dati.tassoInteresse) || 3.5;
        this.tipoPrestito = dati.tipo || 'Prestito';
        this.motivo = dati.motivo || '';
        this.statoPrestito = dati.statoPrestito || 'Richiesto';
        this.motivazioneRifiuto = dati.motivazioneRifiuto || '';
        this.rata = this.calcolaRata();
    }

    generaID() {
        return 'PRE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    calcolaRata() {
        if (this.importo <= 0 || this.durata <= 0) return 0;
        const tassoMensile = this.tassoInteresse / 100 / 12;
        if (tassoMensile === 0) {
            return this.importo / this.durata;
        }
        return this.importo * tassoMensile / (1 - Math.pow(1 + tassoMensile, -this.durata));
    }
}

// ======== CONFIGURAZIONE EMAILJS ========
const EMAILJS_SERVICE_ID  = 'service_h5trm8m';
const EMAILJS_TEMPLATE_ID = 'template_i4y61l8';
const EMAILJS_REGISTER_TEMPLATE_ID = 'template_i4y61l8';
const EMAILJS_PUBLIC_KEY  = 'p6veAdpt1dHoroxMG';

const EMAILJS_OPS_SERVICE_ID  = 'service_ltwbizc';
const EMAILJS_OPERAZIONE_TEMPLATE_ID = 'template_rdkff9a';
const EMAILJS_OPS_PUBLIC_KEY  = 'cKUiA_XrWykTSzesM';

function inviaEmailOperazione(conto) {
    if (typeof emailjs === 'undefined' || !emailjs.send) {
        console.warn('EmailJS non è disponibile. L\'invio mail è saltato.');
        return;
    }

    const templateParams = {
        nome:            conto.titolari[0].nome,
        cognome:         conto.titolari[0].cognome,
        codice_fiscale:  conto.titolari[0].cf,
        data_nascita:    conto.titolari[0].dataNascita,
        luogo_nascita:   conto.titolari[0].luogo,
        provincia:       conto.titolari[0].provincia,
        contatti:        conto.titolari[0].contatti,
        indirizzo:       conto.titolari[0].indirizzo,
        tipo_operazione: conto.tipoPrestito || conto.tipoOperazione || conto.tipoConto || 'Prestito/Mutuo',
        importo:         conto.importo || conto.saldo || '',
        iban:            conto.iban,
        data_operazione: new Date().toLocaleString('it-IT')
    };

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
        .then(() => {
            mostraNotifica('✅ Email di riepilogo inviata con successo!', 'successo');
        })
        .catch((err) => {
            console.error('Errore invio email:', err);
            mostraNotifica('⚠️ Conto creato, ma invio email fallito. Controlla la console.', 'errore');
        });
}

function inviaEmailRegistrazioneCliente(cliente) {
    if (typeof emailjs === 'undefined' || !emailjs.send) {
        console.warn('EmailJS non è disponibile. L\'invio mail è saltato.');
        return;
    }

    const templateParams = {
        nome: cliente.nome,
        email: cliente.email
    };

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_REGISTER_TEMPLATE_ID, templateParams)
        .then((response) => {
            console.log('EmailJS risposta registrazione:', response);
            mostraNotifica('✅ Email di benvenuto inviata con successo!', 'successo');
        })
        .catch((err) => {
            console.error('Errore invio email registrazione:', err);
            mostraNotifica('⚠️ Registrazione completata, ma invio email fallito.', 'errore');
        });
}

function inviaEmailMovimento(cliente, tipoOperazione, importo) {
    if (typeof emailjs === 'undefined' || !emailjs.send) {
        console.warn('EmailJS non disponibile.');
        return;
    }
    const params = {
        nome: cliente.nome,
        email: cliente.email,
        tipo_operazione: tipoOperazione,
        importo: formatCurrency(importo)
    };
    console.log('Invio email operazione:', params);
    emailjs.send(EMAILJS_OPS_SERVICE_ID, EMAILJS_OPERAZIONE_TEMPLATE_ID, params, EMAILJS_OPS_PUBLIC_KEY)
        .then(() => console.log('Email operazione inviata con successo.'))
        .catch(err => console.error('Errore invio email operazione:', err));
}

function mostraNotifica(messaggio, tipo) {
    const esistente = document.getElementById('notificaEmail');
    if (esistente) esistente.remove();

    const notifica = document.createElement('p');
    notifica.id = 'notificaEmail';
    notifica.textContent = messaggio;
    notifica.style.cssText = `
        margin-top: 12px;
        padding: 10px 16px;
        border-radius: 8px;
        font-weight: bold;
        text-align: center;
        font-size: 0.9rem;
        background: ${tipo === 'successo' ? '#d4edda' : '#f8d7da'};
        color:      ${tipo === 'successo' ? '#155724' : '#721c24'};
        border:     1px solid ${tipo === 'successo' ? '#c3e6cb' : '#f5c6cb'};
    `;

    const btn = document.querySelector('.btn-activate');
    if (btn) {
        btn.insertAdjacentElement('afterend', notifica);
        setTimeout(() => notifica.remove(), 6000);
    }
}

// ========== GESTIONE STORAGE CON IndexedDB ==========
const DB_NAME = 'LumiBankDB';
const DB_VERSION = 1;
const STORE_NAME = 'conti';

let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

async function salvaContiIndexedDB(conti) {
    if (!db) await initDB();
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Cancella tutti i record esistenti
    await new Promise((resolve, reject) => {
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => resolve();
        clearRequest.onerror = () => reject(clearRequest.error);
    });
    
    // Salva i nuovi conti
    for (const conto of conti) {
        await new Promise((resolve, reject) => {
            const request = store.add(conto);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

async function caricaContiIndexedDB() {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const conti = request.result.map(normalizzaConto);
            resolve(conti);
        };
        request.onerror = () => reject(request.error);
    });
}

function salvaConto(conto) {
    if (!conto || !conto.id) return;
    const conti = ottieni_conti();
    const index = conti.findIndex(c => c.id === conto.id);
    if (index >= 0) {
        conti[index] = conto;
    } else {
        conti.push(conto);
    }
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    salvaContiIndexedDB(conti).catch(error => {
        console.error('Errore salvataggio IndexedDB:', error);
    });
}

function salvaConti(contiOverride = null) {
    const conti = Array.isArray(contiOverride) ? contiOverride : ottieni_conti();
    // Salva in localStorage come backup
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    
    // Salva in IndexedDB per persistenza automatica
    salvaContiIndexedDB(conti).catch(error => {
        console.error('Errore salvataggio IndexedDB:', error);
    });
}

function ottieni_conti() {
    // Prima prova IndexedDB
    if (db) {
        try {
            // Nota: Questa è sincrona per compatibilità, ma IndexedDB è async
            // Per semplicità, usiamo localStorage come primario e IndexedDB come backup
            const dati = localStorage.getItem('lumibank_conti');
            if (dati) {
                const conti = JSON.parse(dati);
                if (Array.isArray(conti)) {
                    return conti.map(normalizzaConto);
                }
            }
        } catch (error) {
            console.error('Errore caricamento:', error);
        }
    }
    
    // Fallback a localStorage
    const dati = localStorage.getItem('lumibank_conti');
    if (!dati) return [];
    try {
        const conti = JSON.parse(dati);
        if (!Array.isArray(conti)) return [];
        return conti.map(normalizzaConto);
    } catch (error) {
        console.error('Errore parsing conti:', error);
        return [];
    }
}

function normalizzaConto(conto) {
    if (!conto) return conto;
    if (!conto.titolariString && conto.titolari) {
        conto.titolariString = conto.titolari.map(t => `${t.nome} ${t.cognome}`).join(', ');
    }
    if (!conto.movimenti) {
        conto.movimenti = [];
    }
    if (conto.tipoConto === 'Deposito' && !conto.ultimoCalcoloInteresse) {
        conto.ultimoCalcoloInteresse = new Date();
    }
    if (!(conto instanceof Conto)) {
        Object.setPrototypeOf(conto, Conto.prototype);
    }
    return conto;
}

function aggiungiConto(conto) { 
    const conti = ottieni_conti();
    conti.push(normalizzaConto(conto));
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    salvaContiIndexedDB(conti).catch(console.error);
}

// ========== ELIMINAZIONE CONTI ==========
function eliminaConto(contoId) {
    if (!confirm('⚠️ Sei sicuro di voler eliminare questo conto? Questa azione non può essere annullata.')) {
        return;
    }
    
    const conti = ottieni_conti();
    const nuoviConti = conti.filter(c => c.id !== contoId);
    
    localStorage.setItem('lumibank_conti', JSON.stringify(nuoviConti));
    salvaContiIndexedDB(nuoviConti).catch(console.error);
    
    alert('✅ Conto eliminato con successo!');
    chiudiModal();
    caricaDashboard();
}

function richiediPrestito() {
    const importo = parseFloat(document.getElementById('importoPrestito').value);
    const durata = parseInt(document.getElementById('durataPrestito').value, 10);
    const tipo = document.getElementById('tipoPrestito').value;
    const motivo = document.getElementById('motivazionePrestito').value.trim();

    if (!currentClienteId) {
        alert('Devi essere autenticato come cliente per richiedere un prestito.');
        return;
    }

    const contiCliente = ottieni_conti().filter(c => c.clienteId === currentClienteId);
    if (contiCliente.length === 0) {
        alert('❌ Devi avere almeno un conto bancario per richiedere un prestito.\nVai su "Nuovo Conto" per crearne uno.');
        return;
    }

    if (!importo || importo <= 0) {
        alert('Inserisci un importo valido per il prestito.');
        return;
    }
    if (!durata || durata <= 0) {
        alert('Inserisci una durata valida in mesi.');
        return;
    }
    if (!motivo) {
        alert('Inserisci la motivazione della richiesta.');
        return;
    }

    const nuovoPrestito = new Prestito({
        clienteId: currentClienteId,
        importo,
        durata,
        tassoInteresse: 0, // Definito dall'operatore all'accettazione
        tipo,
        motivo,
        statoPrestito: 'Richiesto'
    });

    aggiungiPrestito(nuovoPrestito);
    document.getElementById('importoPrestito').value = '';
    document.getElementById('durataPrestito').value = '';
    document.getElementById('motivazionePrestito').value = '';

    alert('✅ Richiesta di prestito inviata con successo.\nIl tasso di interesse verrà definito dall\'operatore.');
    caricaPrestitiSection();
}

function caricaPrestitiSection() {
    const lista = document.getElementById('prestitiList');
    const richiestaForm = document.getElementById('prestitoRichiestaForm');
    let prestiti = ottieniPrestiti();

    const isCliente = sessionMode === 'cliente' && currentClienteId;
    if (richiestaForm) {
        richiestaForm.classList.toggle('hidden', !isCliente);
    }

    if (isCliente) {
        prestiti = prestiti.filter(p => p.clienteId === currentClienteId);
    }

    if (!prestiti || prestiti.length === 0) {
        lista.innerHTML = `<div class="empty-state"><p>${isCliente ? 'Non hai ancora richieste di prestito.' : 'Nessuna richiesta di prestito trovata.'}</p></div>`;
        return;
    }

    lista.innerHTML = '';
    prestiti.forEach(prestito => {
        const cliente = trovaClientePerId(prestito.clienteId);
        const nomeCliente = cliente ? `${cliente.nome} ${cliente.cognome}` : 'Cliente sconosciuto';
        const statoClass = prestito.statoPrestito === 'Accettato' ? 'status-accepted' : prestito.statoPrestito === 'Respinto' ? 'status-rejected' : 'status-pending';

        let azioni = '';
            const canStaffAct = sessionMode === 'staff';
            const isOwnerCliente = sessionMode === 'cliente' && prestito.clienteId === currentClienteId;

            if (canStaffAct && prestito.statoPrestito === 'Richiesto') {
                azioni += `
                    <div style="margin-top:10px;">
                        <label style="font-size:0.8rem; color:#555; display:block; margin-bottom:4px;">Tasso interesse annuo (%)</label>
                        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                            <input type="number" id="tasso_${prestito.id}" placeholder="es. 3.5" min="0" step="0.01"
                                style="width:100px; padding:6px 8px; border:1px solid var(--border-color); border-radius:6px; font-size:0.9rem;">
                            <button class="btn-action" style="width:auto; margin-top:0; padding:6px 12px; font-size:0.85rem;"
                                onclick="accettaPrestito('${prestito.id}')">✓ Accetta</button>
                            <button class="btn-danger" style="padding:6px 12px; font-size:0.85rem;"
                                onclick="respingiPrestito('${prestito.id}')">✕ Respingi</button>
                        </div>
                    </div>`;
            }

            // Allow deletion: staff can delete any request; client can cancel their own 'Richiesto' requests
            if (canStaffAct || (isOwnerCliente && prestito.statoPrestito === 'Richiesto')) {
                azioni += `
                    <button class="btn-danger" onclick="eliminaPrestito('${prestito.id}')">Elimina richiesta</button>
                `;
            }

        const html = `
            <div class="account-card prestito-card">
                <div class="account-header">
                    <span class="account-icon">🏦</span>
                    <span class="account-type">${prestito.tipoPrestito} - ${prestito.statoPrestito}</span>
                </div>
                <div class="account-iban">${nomeCliente}</div>
                <div class="account-titolari">Importo: € ${formatCurrency(prestito.importo)} — Durata: ${prestito.durata} mesi</div>
                ${prestito.statoPrestito === 'Accettato' ? `<div class="account-titolari">Tasso: ${prestito.tassoInteresse}% — Rata: € ${formatCurrency(prestito.rata)}</div>` : '<div class="account-titolari" style="color:#888; font-size:0.85rem;">Tasso definito dall\'operatore all\'accettazione</div>'}
                <div class="loan-detail"><strong>Motivazione:</strong> ${prestito.motivo}</div>
                <div class="loan-status ${statoClass}">${prestito.statoPrestito}${prestito.statoPrestito === 'Respinto' && prestito.motivazioneRifiuto ? ` — ${prestito.motivazioneRifiuto}` : ''}</div>
                ${azioni}
            </div>
        `;
        lista.insertAdjacentHTML('beforeend', html);
    });
}

function accettaPrestito(prestitoId) {
    const input = document.getElementById('tasso_' + prestitoId);
    if (!input) return;
    const tasso = parseFloat(input.value.replace(',', '.'));
    if (isNaN(tasso) || tasso < 0) {
        alert('❌ Inserisci un tasso di interesse valido (es. 3.5).');
        return;
    }
    const prestiti = ottieniPrestiti();
    const prestito = prestiti.find(p => p.id === prestitoId);
    if (!prestito) return;
    prestito.tassoInteresse = tasso;
    const tassoMensile = tasso / 100 / 12;
    prestito.rata = tassoMensile === 0
        ? prestito.importo / prestito.durata
        : prestito.importo * tassoMensile / (1 - Math.pow(1 + tassoMensile, -prestito.durata));
    prestito.statoPrestito = 'Accettato';
    salvaPrestiti(prestiti);
    caricaPrestitiSection();
}

function respingiPrestito(prestitoId) {
    const motivazione = document.getElementById('tasso_' + prestitoId)
        ? document.getElementById('tasso_' + prestitoId).closest('.account-card') : null;
    const motivo = window.prompt('Indica la motivazione del rifiuto:');
    if (motivo === null) return;
    const prestiti = ottieniPrestiti();
    const prestito = prestiti.find(p => p.id === prestitoId);
    if (!prestito) return;
    prestito.motivazioneRifiuto = motivo.trim();
    prestito.statoPrestito = 'Respinto';
    salvaPrestiti(prestiti);
    caricaPrestitiSection();
}

function impostaStatoPrestito(prestitoId, nuovoStato) {
    if (nuovoStato === 'Accettato') accettaPrestito(prestitoId);
    else respingiPrestito(prestitoId);
}

function eliminaPrestito(prestitoId) {
    if (!confirm('⚠️ Sei sicuro di voler eliminare questa richiesta di prestito?')) return;
    try {
        let prestiti = ottieniPrestiti();
        prestiti = prestiti.filter(p => p.id !== prestitoId);
        salvaPrestiti(prestiti);
        caricaPrestitiSection();
        alert('✅ Richiesta di prestito eliminata.');
    } catch (e) {
        console.error('Errore eliminazione prestito:', e);
        alert('Errore durante l\'eliminazione della richiesta. Controlla la console.');
    }
}

// Inizializzazione auto-save se era abilitato
if (localStorage.getItem('lumibank_autoSave_enabled') && 'showSaveFilePicker' in window) {
    // Nota: Non possiamo ripristinare il fileHandle automaticamente per sicurezza,
    // ma possiamo ricordare che era abilitato
}

// ========== NUOVO CONTO ==========
let numCointestatari = 0;

function aggiungiCointestatario() {
    if (numCointestatari >= 2) {
        alert("Massimo 3 titolari (1 principale + 2 cointestatari)");
        return;
    }
    
    numCointestatari++;
    const container = document.getElementById('cointestatariContainer');
    const id = `cointestatario_${numCointestatari}`;
    
    const html = `
        <div id="${id}" class="form-section" style="background: #f9f9f9; margin-bottom: 10px;">
            <h4 style="margin-top: 0;">Cointestatario ${numCointestatari}</h4>
            <div class="grid-container">
                <div class="input-field">
                    <label>Nome</label>
                    <input type="text" class="cointestatario-nome" placeholder="Nome">
                </div>
                <div class="input-field">
                    <label>Cognome</label>
                    <input type="text" class="cointestatario-cognome" placeholder="Cognome">
                </div>
                <div class="input-field full-width">
                    <label>Codice Fiscale</label>
                    <input type="text" class="cointestatario-cf" placeholder="16 caratteri" maxlength="16" style="text-transform: uppercase;">
                </div>
                <div class="input-field">
                    <label>Data di Nascita</label>
                    <input type="date" class="cointestatario-dataNascita">
                </div>
                <div class="input-field">
                    <label>Luogo di Nascita</label>
                    <input type="text" class="cointestatario-luogo" placeholder="Città">
                </div>
                <div class="input-field">
                    <label>Provincia</label>
                    <input type="text" class="cointestatario-provincia" maxlength="2" placeholder="XX" style="text-transform: uppercase;">
                </div>
            </div>
            <button class="btn-remove" onclick="rimuoviCointestatario('${id}')">Rimuovi</button>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', html);
    
    if (numCointestatari === 2) {
        document.getElementById('btnAggiungiCointestatario').disabled = true;
    }
}

function rimuoviCointestatario(id) {
    document.getElementById(id).remove();
    numCointestatari--;
    document.getElementById('btnAggiungiCointestatario').disabled = false;
}

function creaNuovoConto() {
    if (sessionMode === 'cliente' && !currentClienteId) {
        alert('❌ Devi essere autenticato come cliente per inviare una richiesta.');
        return;
    }
    // Validazione dati titolare principale
    const nome = document.getElementById('nomeUtente').value.trim();
    const cognome = document.getElementById('cognomeUtente').value.trim();
    const cf = document.getElementById('codiceFiscale').value.trim().toUpperCase();
    const dataNascita = document.getElementById('dataNascita').value;
    const luogo = document.getElementById('luogoNascita').value.trim();
    const provincia = document.getElementById('provinciaNascita').value.trim().toUpperCase();
    const contatti = document.getElementById('contatti').value.trim();
    const indirizzo = document.getElementById('indirizzo').value.trim();
    
    // Validazioni specifiche con messaggi chiari
    if (!nome) {
        alert("❌ Inserisci il Nome");
        return;
    }
    if (!cognome) {
        alert("❌ Inserisci il Cognome");
        return;
    }
    if (!cf) {
        alert("❌ Inserisci il Codice Fiscale");
        return;
    }
    if (cf.length !== 16) {
        alert("❌ Il Codice Fiscale deve avere esattamente 16 caratteri\n(Attualmente: " + cf.length + " caratteri)");
        return;
    }
    if (!dataNascita) {
        alert("⚠️ Inserisci la Data di Nascita");
        return;
    }
    if (!luogo) {
        alert("⚠️ Inserisci il Luogo di Nascita");
        return;
    }
    if (!provincia) {
        alert("⚠️ Inserisci la Provincia");
        return;
    }
    if (!contatti) {
        alert("⚠️ Inserisci il numero di telefono");
        return;
    }
    if (!/^\d+$/.test(contatti)) {
        alert("❌ Il numero di telefono può contenere solo cifre");
        return;
    }
    if (contatti.length > 10) {
        alert("❌ Il numero di telefono non può superare 10 cifre");
        return;
    }
    if (!indirizzo) {
        alert("⚠️ Inserisci l'Indirizzo");
        return;
    }
    
    // Raccolta dati
    const dati = {
        nome,
        cognome,
        cf,
        dataNascita,
        luogo,
        provincia,
        contatti,
        indirizzo,
        cointestatari: []
    };
    
    // Raccolta cointestatari
    const cointestatari = document.querySelectorAll('[id^="cointestatario_"]');
    for (const el of cointestatari) {
        const nome = el.querySelector('.cointestatario-nome').value.trim();
        const cognome = el.querySelector('.cointestatario-cognome').value.trim();
        const cf = el.querySelector('.cointestatario-cf').value.trim().toUpperCase();
        const dataNascitaCointest = el.querySelector('.cointestatario-dataNascita').value;
        const luogoCointest = el.querySelector('.cointestatario-luogo').value.trim();
        const provinciaCointest = el.querySelector('.cointestatario-provincia').value.trim().toUpperCase();

        if (nome || cognome || cf || dataNascitaCointest || luogoCointest || provinciaCointest) {
            if (!nome || !cognome || !cf || cf.length !== 16 || !dataNascitaCointest || !luogoCointest || !provinciaCointest) {
                alert("❌ Compila correttamente tutti i dati del cointestatario");
                return;
            }
            dati.cointestatari.push({
                nome,
                cognome,
                cf,
                dataNascita: dataNascitaCointest,
                luogo: luogoCointest,
                provincia: provinciaCointest,
                contatti: '',
                indirizzo: dati.indirizzo
            });
        }
    }
    
    const tipo = document.querySelector('input[name="tipoConto"]:checked').value;

    function resetFormConto() {
        document.getElementById('nomeUtente').value = '';
        document.getElementById('cognomeUtente').value = '';
        document.getElementById('codiceFiscale').value = '';
        document.getElementById('dataNascita').value = '';
        document.getElementById('luogoNascita').value = '';
        document.getElementById('provinciaNascita').value = '';
        document.getElementById('contatti').value = '';
        document.getElementById('indirizzo').value = '';
        document.getElementById('cointestatariContainer').innerHTML = '';
        numCointestatari = 0;
        document.getElementById('btnAggiungiCointestatario').disabled = false;
    }

    if (sessionMode === 'staff') {
        // Operatore: crea il conto direttamente
        try {
            const nuovoConto = new Conto(dati, tipo, 0);
            aggiungiConto(nuovoConto);
            resetFormConto();
            alert(`✅ Conto creato con successo!\n\nIBAN: ${nuovoConto.iban}\nTipo: ${tipo}`);
            mostraSezione('dashboard');
        } catch (error) {
            alert("❌ Errore nella creazione del conto:\n" + error.message);
            console.error(error);
        }
    } else {
        // Limite massimo 3 conti per cliente (conti attivi + richieste in attesa)
        const contiAttivi = ottieni_conti().filter(c => c.clienteId === currentClienteId).length;
        const richiesteInAttesa = ottieniRichiesteConto().filter(r => r.clienteId === currentClienteId && r.stato === 'In attesa').length;
        if (contiAttivi + richiesteInAttesa >= 3) {
            alert('❌ Hai raggiunto il limite massimo di 3 conti.');
            return;
        }

        // Cliente: invia richiesta in attesa di approvazione
        const richiesta = {
            id: 'REQCONTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            stato: 'In attesa',
            clienteId: currentClienteId,
            dataRichiesta: new Date().toLocaleDateString('it-IT'),
            dati: dati,
            tipoConto: tipo
        };
        aggiungiRichiestaConto(richiesta);
        resetFormConto();
        alert('✅ Richiesta inviata!\nL\'operatore esaminerà la tua richiesta di apertura conto.');
        mostraSezione('dashboard');
    }
}

// ========== DASHBOARD ==========
let contoSelezionato = null;
let clienteSelezionatoStaff = null;

function caricaDashboard() {
    const lista = document.getElementById('accountsList');
    const titleElement = document.getElementById('dashboardTitle');
    
    if (sessionMode === 'staff') {
        // DASHBOARD STAFF - Mostra statistiche + clienti
                titleElement.textContent = 'Gestione Clienti e Conti';
        
                const clienti = ottieniClienti();
                const conti = ottieni_conti();
        
                // Nascondi grafico torta (solo per clienti)
                const chartContainer = document.getElementById('usciteChartContainer');
                if (chartContainer) chartContainer.classList.add('hidden');

                // Renderizza statistiche
                const statsHtml = StatsRenderer.renderStatsBar();
                lista.innerHTML = statsHtml;
        
                // Renderizza clienti
                const clientiHtml = clienti.length === 0 
                    ? '<div class="empty-state"><p>Nessun cliente registrato.</p></div>'
                    : `<div class="clients-list">${clienti.map(cliente => {
                        const contiCliente = conti.filter(c => c.clienteId === cliente.id);
                        return CardRenderer.renderCliente(cliente, contiCliente);
                    }).join('')}</div>`;
        
                lista.insertAdjacentHTML('beforeend', clientiHtml);

                // Richieste apertura conto in attesa
                const richiesteConto = ottieniRichiesteConto();
                const richiesteInAttesa = richiesteConto.filter(r => r.stato === 'In attesa');
                if (richiesteInAttesa.length > 0) {
                    const richiesteHtml = `
                        <div class="section-header" style="margin-top:28px; margin-bottom:12px;">
                            <h3 style="color:var(--accent);">📋 Richieste apertura conto (${richiesteInAttesa.length})</h3>
                        </div>
                        <div class="accounts-grid">${richiesteInAttesa.map(r => CardRenderer.renderRichiestaConto(r)).join('')}</div>`;
                    lista.insertAdjacentHTML('beforeend', richiesteHtml);
                }
    } else {
        // DASHBOARD CLIENTE - Mostra conti propri
        titleElement.textContent = 'I Tuoi Conti Bancari';
        let conti = ottieni_conti();
        
        if (currentClienteId) {
            conti = conti.filter(c => c.clienteId === currentClienteId);
        } else {
            lista.innerHTML = '<div class="empty-state"><p>Non hai ancora un conto. Vai su "Nuovo Conto" per crearlo.</p></div>';
            return;
        }
        
        const contiHtml = conti.length === 0
            ? '<div class="empty-state"><p>Non hai ancora un conto. Vai su "Nuovo Conto" per crearlo.</p></div>'
            : conti.map(conto => CardRenderer.renderConto(conto)).join('');

        lista.innerHTML = contiHtml;
        aggiornaGraficoUscite(conti);

        // Mostra solo richieste conto in attesa del cliente
        const richiesteInAttesa = ottieniRichiesteConto().filter(r => r.clienteId === currentClienteId && r.stato === 'In attesa');
        if (richiesteInAttesa.length > 0) {
            const richiesteHtml = `
                <div style="margin-top:32px;">
                    <h3 style="font-size:1rem; color:var(--primary); margin-bottom:12px; padding-bottom:8px; border-bottom:2px solid var(--border-color);">
                        ⏳ Richieste in attesa di approvazione
                    </h3>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${richiesteInAttesa.map(r => `
                            <div style="display:flex; align-items:center; justify-content:space-between; background:var(--card-bg); border:1px solid var(--border-color); border-radius:10px; padding:14px 18px;">
                                <div style="display:flex; align-items:center; gap:12px;">
                                    <span style="font-size:1.4rem;">📋</span>
                                    <div>
                                        <div style="font-weight:600; font-size:0.95rem;">Conto ${r.tipoConto}</div>
                                        <div style="font-size:0.8rem; color:#888; margin-top:2px;">Inviata il ${r.dataRichiesta}</div>
                                    </div>
                                </div>
                                <span class="loan-status status-pending" style="margin:0; white-space:nowrap;">⏳ In attesa</span>
                            </div>`).join('')}
                    </div>
                </div>`;
            lista.insertAdjacentHTML('beforeend', richiesteHtml);
        }
    }
}

let usciteChartInstance = null;

function aggiornaGraficoUscite(conti) {
    const container = document.getElementById('usciteChartContainer');
    const legenda = document.getElementById('usciteChartLegenda');
    const totaleLabel = document.getElementById('usciteTotaleLabel');
    if (!container) return;

    // Aggrega uscite per categoria
    const totali = {};
    let totaleUscite = 0;
    conti.forEach(conto => {
        (conto.movimenti || []).forEach(mov => {
            if (mov.tipo !== 'Uscita') return;
            const cat = mov.categoria || mov.tipoOperazione || 'Altro';
            totali[cat] = (totali[cat] || 0) + mov.importo;
            totaleUscite += mov.importo;
        });
    });

    const categorie = Object.keys(totali);
    if (categorie.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const palette = ['#27ae60','#e74c3c','#9b59b6','#3498db'];
    const colori = categorie.map((_, i) => palette[i % palette.length]);
    const valori = categorie.map(c => totali[c]);

    // Distruggi chart precedente se esiste
    if (usciteChartInstance) {
        usciteChartInstance.destroy();
        usciteChartInstance = null;
    }

    const isDark = document.body.classList.contains('dark-mode');
    const testoColore = isDark ? '#e0e0e0' : '#222';
    const testoMuted = isDark ? '#aaa' : '#444';
    const borderColore = isDark ? '#2a2a2a' : '#fff';

    const ctx = document.getElementById('usciteChart').getContext('2d');
    usciteChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: categorie,
            datasets: [{ data: valori, backgroundColor: colori, borderWidth: 2, borderColor: borderColore }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1e1e1e' : 'rgba(0,0,0,0.8)',
                    titleColor: isDark ? '#e0e0e0' : '#fff',
                    bodyColor: isDark ? '#e0e0e0' : '#fff',
                    borderColor: isDark ? '#444' : 'transparent',
                    borderWidth: isDark ? 1 : 0
                }
            },
            animation: { duration: 500 }
        }
    });

    // Legenda custom
    legenda.innerHTML = categorie.map((cat, i) => `
        <div style="display:flex; align-items:center; gap:8px; font-size:0.85rem;">
            <span style="width:12px; height:12px; border-radius:3px; background:${colori[i]}; flex-shrink:0;"></span>
            <span style="flex:1; color:${testoMuted};">${cat}</span>
            <span style="font-weight:600; color:${testoColore};">€ ${formatCurrency(totali[cat])}</span>
        </div>
    `).join('');

    totaleLabel.innerHTML = `<span style="color:${testoMuted}; font-weight:600;">Totale uscite:</span> <span style="color:#e74c3c; font-weight:700;">€ ${formatCurrency(totaleUscite)}</span>`;
}

function apriGestioneClienteModal(clienteId) {
    const cliente = trovaClientePerId(clienteId);
    if (!cliente) return;
    
    clienteSelezionatoStaff = cliente;
    
    // Info Cliente
    document.getElementById('gestioneClienteTitle').textContent = `Gestione Cliente - ${cliente.nome} ${cliente.cognome}`;
    document.getElementById('gestioneClienteNome').textContent = `${cliente.nome} ${cliente.cognome}`;
    document.getElementById('gestioneClienteEmail').textContent = cliente.email;
    document.getElementById('gestioneClienteData').textContent = cliente.registratoIl;
    
    // Conti del cliente
    const conti = ottieni_conti().filter(c => c.clienteId === cliente.id);
    const saldoTotale = conti.reduce((sum, c) => sum + (c.saldo || 0), 0);
    document.getElementById('gestioneClienteSaldoTotale').textContent = `€ ${formatCurrency(saldoTotale)}`;
    
    // Mostra conti
    const contiDiv = document.getElementById('gestioneClienteConti');
    if (conti.length === 0) {
        contiDiv.innerHTML = '<div class="empty-state"><p>Nessun conto associato.</p></div>';
    } else {
        contiDiv.innerHTML = '';
        conti.forEach(conto => {
            const iconaTipo = conto.tipoConto === 'Canone Fisso' ? '💳' : 
                              conto.tipoConto === 'Senza Canone' ? '🍃' : '📈';
            const html = `
                <div class="account-card" onclick="apriDettagliConto('${conto.id}')">
                    <div class="account-header">
                        <span class="account-icon">${iconaTipo}</span>
                        <span class="account-type">${conto.tipoConto}</span>
                    </div>
                    <div class="account-iban">${conto.iban}</div>
                    <div class="account-balance">€ ${formatCurrency(conto.saldo)}</div>
                </div>
            `;
            contiDiv.insertAdjacentHTML('beforeend', html);
        });
    }
    
    // Ultimi movimenti di tutti i conti del cliente
    const movimentiDiv = document.getElementById('gestioneClienteMovimenti');
    const tuttiMovimenti = [];
    conti.forEach(conto => {
        if (conto.movimenti) {
            conto.movimenti.forEach(mov => {
                tuttiMovimenti.push({...mov, contoIban: conto.iban});
            });
        }
    });
    
    // Ordina per data (più recenti prima)
    tuttiMovimenti.sort((a, b) => new Date(b.dataContabile) - new Date(a.dataContabile));
    
    if (tuttiMovimenti.length === 0) {
        movimentiDiv.innerHTML = '<p class="empty-text">Nessun movimento trovato.</p>';
    } else {
        movimentiDiv.innerHTML = '';
        tuttiMovimenti.slice(0, 10).forEach(mov => {
            const colore = mov.tipo === 'Entrata' ? 'color: #27ae60' : 'color: #e74c3c';
            const simbolo = mov.tipo === 'Entrata' ? '+' : '-';
            const html = `
                <div class="movimento-item">
                    <div class="movimento-info">
                        <div><strong>${mov.tipoOperazione}</strong></div>
                        <small>${mov.dataContabile} | ${mov.causale}</small>
                        <small style="color: #999; display: block; margin-top: 4px;">IBAN: ${mov.contoIban}</small>
                    </div>
                    <div class="movimento-amount" style="${colore}">
                        ${simbolo} € ${formatCurrency(mov.importo)}
                    </div>
                </div>
            `;
            movimentiDiv.insertAdjacentHTML('beforeend', html);
        });
    }
    
    // Apri modal: sposto il modal in fondo al body per garantire che sia in primo piano
    const gestioneModalEl = document.getElementById('gestioneClienteModal');
    if (gestioneModalEl && gestioneModalEl.parentNode !== document.body) document.body.appendChild(gestioneModalEl);
    // Assicuro z-index base per il modal di gestione
    if (gestioneModalEl) gestioneModalEl.style.zIndex = '2000';
    gestioneModalEl.classList.remove('hidden');
}

function chiudiGestioneClienteModal() {
    document.getElementById('gestioneClienteModal').classList.add('hidden');
    clienteSelezionatoStaff = null;
    caricaDashboard();
}

function accettaRichiestaConto(id) {
    const richieste = ottieniRichiesteConto();
    const idx = richieste.findIndex(r => r.id === id);
    if (idx === -1) return;
    const r = richieste[idx];
    try {
        const nuovoConto = new Conto(r.dati, r.tipoConto, 0);
        if (r.clienteId) nuovoConto.clienteId = r.clienteId;
        aggiungiConto(nuovoConto);
        richieste[idx].stato = 'Accettato';
        salvaRichiesteConto(richieste);
        alert(`✅ Richiesta accettata!\nConto creato: ${nuovoConto.iban}`);
    } catch (error) {
        alert('❌ Errore nella creazione del conto:\n' + error.message);
    }
    caricaDashboard();
}

function rifiutaRichiestaConto(id) {
    if (!confirm('Sei sicuro di voler rifiutare questa richiesta di apertura conto?')) return;
    const richieste = ottieniRichiesteConto();
    const idx = richieste.findIndex(r => r.id === id);
    if (idx === -1) return;
    richieste[idx].stato = 'Rifiutato';
    salvaRichiesteConto(richieste);
    caricaDashboard();
}

function eliminaClienteStaff(clienteId) {
    if (!confirm('⚠️ Sei sicuro di voler eliminare questo account cliente? Tutti i conti e prestiti associati saranno rimossi.')) {
        return;
    }

    const clienti = ottieniClienti().filter(c => c.id !== clienteId);
    salvaClienti(clienti);

    const conti = ottieni_conti().filter(c => c.clienteId !== clienteId);
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    salvaContiIndexedDB(conti).catch(console.error);

    // Rimuovi anche le richieste di prestito associate al cliente
    try {
        const prestiti = ottieniPrestiti().filter(p => p.clienteId !== clienteId);
        salvaPrestiti(prestiti);
    } catch (e) {
        console.error('Errore rimozione prestiti cliente:', e);
    }

    if (currentClienteId === clienteId) {
        currentClienteId = null;
        sessionStorage.removeItem(CLIENT_SESSION_KEY);
        sessionStorage.removeItem('lumibank_sessionMode');
        logoutCliente();
    }

    alert('✅ Account cliente eliminato con successo.');
    chiudiGestioneClienteModal();
}

function cercaClienteStaff(clienteId) {
    const cliente = trovaClientePerId(clienteId);
    if (cliente) {
        document.getElementById('gestioneSearchInput').value = cliente.email;
        cercaContiInGestione();
    }
}

function caricaGestioneConti() {
    const conti = ottieni_conti();
    const lista = document.getElementById('gestioneContiList');
    if (!lista) return;

    if (!conti.length) {
        lista.innerHTML = '<div class="empty-state"><p>Nessun conto trovato.</p></div>';
        return;
    }

    lista.innerHTML = '';
    conti.forEach(conto => {
        const html = `
            <div class="account-card" onclick="apriDettagliConto('${conto.id}')">
                <div class="account-header">
                    <span class="account-icon">💳</span>
                    <span class="account-type">${conto.tipoConto}</span>
                </div>
                <div class="account-iban">${conto.iban}</div>
                <div class="account-titolari">${conto.titolariString || 'Nessun titolare'}</div>
                <div class="account-balance">Saldo: € ${formatCurrency(conto.saldo)}</div>
            </div>
        `;
        lista.insertAdjacentHTML('beforeend', html);
    });
}

function cercaContiInGestione() {
    if (sessionMode !== 'staff') {
        alert('Solo l\'operatore può effettuare ricerche dei conti.');
        return;
    }

    const query = document.getElementById('gestioneSearchInput').value.trim().toLowerCase();
    const lista = document.getElementById('gestioneContiList');
    if (!lista) return;

    const conti = ottieni_conti().filter(c =>
        (c.iban || '').toLowerCase().includes(query) ||
        ((c.titolariString || '').toLowerCase().includes(query))
    );

    if (!query) {
        return caricaGestioneConti();
    }

    if (conti.length === 0) {
        lista.innerHTML = '<div class="empty-state"><p>Nessun conto trovato.</p></div>';
        return;
    }

    lista.innerHTML = '';
    conti.forEach(conto => {
        const html = `
            <div class="account-card" onclick="apriDettagliConto('${conto.id}')">
                <div class="account-header">
                    <span class="account-icon">💳</span>
                    <span class="account-type">${conto.tipoConto}</span>
                </div>
                <div class="account-iban">${conto.iban}</div>
                <div class="account-titolari">${conto.titolariString || 'Nessun titolare'}</div>
                <div class="account-balance">Saldo: € ${formatCurrency(conto.saldo)}</div>
            </div>
        `;
        lista.insertAdjacentHTML('beforeend', html);
    });
}

function eliminaCliente(clienteId) {
    if (!confirm('⚠️ Sei sicuro di voler eliminare questo account cliente? Tutti i conti associati saranno rimossi.')) {
        return;
    }

    const clienti = ottieniClienti().filter(c => c.id !== clienteId);
    salvaClienti(clienti);

    const conti = ottieni_conti().filter(c => c.clienteId !== clienteId);
    localStorage.setItem('lumibank_conti', JSON.stringify(conti));
    salvaContiIndexedDB(conti).catch(console.error);

    // Rimuovi anche le richieste di prestito associate al cliente
    try {
        const prestiti = ottieniPrestiti().filter(p => p.clienteId !== clienteId);
        salvaPrestiti(prestiti);
    } catch (e) {
        console.error('Errore rimozione prestiti cliente:', e);
    }

    if (currentClienteId === clienteId) {
        currentClienteId = null;
        sessionStorage.removeItem(CLIENT_SESSION_KEY);
        sessionStorage.removeItem('lumibank_sessionMode');
        logoutCliente();
    }

    alert('✅ Account cliente eliminato con successo.');
    caricaGestioneConti();
}

function apriDettagliConto(contoId) {
    const conti = ottieni_conti();
    contoSelezionato = conti.find(c => c.id === contoId);
    
    if (!contoSelezionato) return;
    
    // Controllo di accesso: clienti possono visualizzare solo i propri conti
    if (sessionMode === 'cliente' && contoSelezionato.clienteId !== currentClienteId) {
        alert('❌ Non puoi accedere a questo conto. Non ti appartiene.');
        return;
    }
    
    // Aggiorna modal header
    document.getElementById('modalTitle').textContent = `${contoSelezionato.tipoConto} - ${contoSelezionato.iban}`;
    
    // TAB INFORMAZIONI
    document.getElementById('modalIban').textContent = contoSelezionato.iban;
    document.getElementById('modalSaldo').textContent = `€ ${formatCurrency(contoSelezionato.saldo)}`;
    document.getElementById('modalTipoConto').textContent = contoSelezionato.tipoConto;
    document.getElementById('modalTitolari').textContent = contoSelezionato.titolariString || (contoSelezionato.titolari || []).map(t => `${t.nome} ${t.cognome}`).join(', ');
    
    const canoneText = contoSelezionato.tipoConto === 'Canone Fisso' ? 'EUR 15,00/mese' :
                       contoSelezionato.tipoConto === 'Senza Canone' ? 'EUR 0,00 (Commissioni: EUR 3,00/op. in filiale)' :
                       `Tasso: ${contoSelezionato.tassoInteresse}% - Interessi accumulati: EUR ${formatCurrency(contoSelezionato.interessiAccumulati)}`;
    document.getElementById('modalCanone').textContent = canoneText;
    
    const deleteBtn = document.getElementById('deleteAccountBtn');
    if (deleteBtn) {
        deleteBtn.style.display = sessionMode === 'staff' ? 'inline-block' : 'none';
    }

    // Box tasso deposito: solo staff + solo conto deposito
    const tassoBox = document.getElementById('tassoDepositoStaffBox');
    const tassoInput = document.getElementById('tassoDepositoInput');
    if (tassoBox && tassoInput) {
        const mostra = sessionMode === 'staff' && contoSelezionato.tipoConto === 'Deposito';
        tassoBox.classList.toggle('hidden', !mostra);
        if (mostra) tassoInput.value = contoSelezionato.tassoInteresse || 0;
    }

    // Ripristina il tab informazioni di default ogni volta che si apre il modal
    const infoTabButton = document.querySelector('#dettagliContoModal .tab-btn');
    if (infoTabButton) {
        cambiaTab('infoTab', infoTabButton);
    }

    // Carica movimenti e prestiti se la sezione è presente nel modal
    if (document.getElementById('movimentiList')) {
        caricaMovimenti();
    }
    if (document.getElementById('prestitiDettaglioList')) {
        caricaPrestitiDettaglio();
    }

    // Popola select Giroconto solo se presente
    const contoDestSelect = document.getElementById('contoDest');
    if (contoDestSelect) {
        contoDestSelect.innerHTML = '<option value="">Seleziona conto destinatario</option>';
        const tuttiConti = ottieni_conti();
        const contiDisponibili = sessionMode === 'cliente'
            ? tuttiConti.filter(c => c.id !== contoSelezionato.id && c.clienteId === currentClienteId)
            : tuttiConti.filter(c => c.id !== contoSelezionato.id);
        contiDisponibili.forEach(c => {
            contoDestSelect.innerHTML += `<option value="${c.id}">${c.titolariString || c.iban} - ${c.iban}</option>`;
        });
    }

    // Mostra modal: sposto il modal in fondo al body per garantire che sia in primo piano
    const dettagliModalEl = document.getElementById('dettagliContoModal');
    if (dettagliModalEl && dettagliModalEl.parentNode !== document.body) document.body.appendChild(dettagliModalEl);
    // Metto il modal dei dettagli sopra il modal di gestione (z-index maggiore)
    if (dettagliModalEl) {
        dettagliModalEl.style.zIndex = '3000';
    }
    // Se il modal di gestione è aperto, abbassalo temporaneamente
    const gestioneModalEl2 = document.getElementById('gestioneClienteModal');
    if (gestioneModalEl2) gestioneModalEl2.style.zIndex = '2000';
    dettagliModalEl.classList.remove('hidden');
}

function chiudiModal() {
    document.getElementById('dettagliContoModal').classList.add('hidden');
    caricaDashboard();
}

function caricaMovimenti() {
    const lista = document.getElementById('movimentiList');
    if (!lista) return;
    
    if (!contoSelezionato.movimenti || contoSelezionato.movimenti.length === 0) {
        lista.innerHTML = '<p class="empty-text">Nessun movimento ancora</p>';
    } else {
        lista.innerHTML = '';
        contoSelezionato.movimenti.forEach(mov => {
            lista.insertAdjacentHTML('beforeend', CardRenderer.renderMovimento(mov, contoSelezionato.iban));
        });
    }
}

function caricaPrestitiDettaglio() {
    const listaPrestiti = document.getElementById('prestitiDettaglioList');
    if (!listaPrestiti || !contoSelezionato) return;

    const prestiti = ottieniPrestiti().filter(p => p.clienteId === contoSelezionato.clienteId);
    if (!prestiti || prestiti.length === 0) {
        listaPrestiti.innerHTML = '<div class="empty-state"><p>Nessun prestito o mutuo associato.</p></div>';
        return;
    }

    listaPrestiti.innerHTML = prestiti.map(p => CardRenderer.renderPrestito(p)).join('');
}

// ========== OPERAZIONI BANCARIE ==========
function eseguiVersamento() {
    const importo = parseFloat(document.getElementById('importoVersamento').value);
    const tipo = document.getElementById('tipoVersamento').value;
    
    if (!importo || importo <= 0) {
        alert("Inserisci un importo valido");
        return;
    }
    
    // Applica commissioni se Senza Canone in filiale
    let commissione = 0;
    if (contoSelezionato.tipoConto === 'Senza Canone' && tipo === 'Versamento sportello') {
        commissione = contoSelezionato.commissioni;
    }
    
    const netto = importo - commissione;
    if (netto > 10000000) {
        alert('❌ Il limite massimo per una singola entrata è € 10.000.000,00.');
        return;
    }
    contoSelezionato.saldo += netto;
    contoSelezionato.registraMovimento('Entrata', netto, tipo, `Versamento ${tipo}`);
    
    alert(`✓ Versamento di EUR ${formatCurrency(netto)} confermato${commissione > 0 ? `\nCommissione: EUR ${formatCurrency(commissione)}` : ''}`);
    
    document.getElementById('importoVersamento').value = '';
    caricaMovimenti();
    chiudiModal();
}

function eseguiPrelevamento() {
    const importo = parseFloat(document.getElementById('importoPrelevamento').value);
    const tipo = document.getElementById('tipoPrelevamento').value;
    
    if (!importo || importo <= 0) {
        alert("Inserisci un importo valido");
        return;
    }
    
    // Applica commissioni se Senza Canone in filiale
    let commissione = 0;
    if (contoSelezionato.tipoConto === 'Senza Canone' && tipo === 'Prelevamento sportello') {
        commissione = contoSelezionato.commissioni;
    }
    
    const totale = importo + commissione;
    
    if (contoSelezionato.saldo < totale) {
        alert("Saldo insufficiente");
        return;
    }
    
    contoSelezionato.saldo -= totale;
    contoSelezionato.registraMovimento('Uscita', totale, tipo, `Prelevamento ${tipo}`);
    
    alert(`✓ Prelevamento di EUR ${formatCurrency(importo)} confermato${commissione > 0 ? `\nCommissione: EUR ${formatCurrency(commissione)}` : ''}`);
    
    document.getElementById('importoPrelevamento').value = '';
    caricaMovimenti();
    chiudiModal();
}

function eseguiBonificio() {
    const iban = document.getElementById('ibanbonificio').value.trim();
    const causale = document.getElementById('causalbonificio').value.trim();
    const importo = parseFloat(document.getElementById('importobonificio').value);
    
    if (!iban || !importo || importo <= 0) {
        alert("Inserisci IBAN e importo validi");
        return;
    }
    
    if (contoSelezionato.saldo < importo) {
        alert("Saldo insufficiente");
        return;
    }
    
    contoSelezionato.saldo -= importo;
    contoSelezionato.registraMovimento('Uscita', importo, 'Bonifico', causale);
    
    alert(`✓ Bonifico di EUR ${formatCurrency(importo)} a ${iban} confermato`);
    
    document.getElementById('ibanbonificio').value = '';
    document.getElementById('causalbonificio').value = '';
    document.getElementById('importobonificio').value = '';
    caricaMovimenti();
    chiudiModal();
}

function eseguiGiroconto() {
    const contoDestId = document.getElementById('contoDest').value;
    const importo = parseFloat(document.getElementById('importoGiroconto').value);
    
    if (!contoDestId || !importo || importo <= 0) {
        alert("Seleziona conto e inserisci importo");
        return;
    }
    
    if (contoSelezionato.saldo < importo) {
        alert("Saldo insufficiente");
        return;
    }
    
    const conti = ottieni_conti();
    const contoDest = conti.find(c => c.id === contoDestId);
    
    if (!contoDest) return;
    
    contoSelezionato.saldo -= importo;
    contoDest.saldo += importo;
    
    const nomeDest = (contoDest.titolariString || (contoDest.titolari || []).map(t => `${t.nome} ${t.cognome}`).join(', ')).split(',')[0];
    const nomeOrigine = (contoSelezionato.titolariString || (contoSelezionato.titolari || []).map(t => `${t.nome} ${t.cognome}`).join(', ')).split(',')[0];
    contoSelezionato.registraMovimento('Uscita', importo, 'Giroconto', `Giroconto verso ${nomeDest}`);
    contoDest.registraMovimento('Entrata', importo, 'Giroconto', `Giroconto da ${nomeOrigine}`);
    
    alert(`✓ Giroconto di EUR ${formatCurrency(importo)} confermato`);
    
    document.getElementById('importoGiroconto').value = '';
    caricaMovimenti();
    chiudiModal();
}

function registraMovimentoGenerico() {
    const tipo = document.getElementById('tipoMovimentoGenerico').value;
    const importo = parseFloat(document.getElementById('importoMovimentoGenerico').value);
    const causale = document.getElementById('causaleMovimentoGenerico').value.trim() || (tipo === 'Entrata' ? 'Entrata registrata' : 'Uscita registrata');

    if (!importo || importo <= 0) {
        alert('Inserisci un importo valido per il movimento.');
        return;
    }

    if (tipo === 'Uscita' && contoSelezionato.saldo < importo) {
        alert('Saldo insufficiente per registrare questa uscita.');
        return;
    }

    if (tipo === 'Entrata' && importo > 10000000) {
        alert('❌ Il limite massimo per una singola entrata è € 10.000.000,00.');
        return;
    }

    if (tipo === 'Entrata') {
        contoSelezionato.saldo += importo;
    } else {
        contoSelezionato.saldo -= importo;
    }

    contoSelezionato.registraMovimento(tipo, importo, tipo, causale);

    document.getElementById('importoMovimentoGenerico').value = '';
    document.getElementById('causaleMovimentoGenerico').value = '';
    document.getElementById('modalSaldo').textContent = `€ ${formatCurrency(contoSelezionato.saldo)}`;
    caricaMovimenti();

    alert(`✓ Movimento ${tipo.toLowerCase()} registrato correttamente.`);
}


function salvaTassoDeposito() {
    if (sessionMode !== 'staff') return;
    if (!contoSelezionato || contoSelezionato.tipoConto !== 'Deposito') return;

    const val = parseFloat(document.getElementById('tassoDepositoInput').value);
    if (isNaN(val) || val < 0 || val > 20) {
        alert('Inserisci un tasso valido tra 0 e 20%.');
        return;
    }

    contoSelezionato.tassoInteresse = val;
    salvaConto(contoSelezionato);

    // Aggiorna la visualizzazione nel modal
    document.getElementById('modalCanone').textContent =
        `Tasso: ${val}% - Interessi accumulati: EUR ${formatCurrency(contoSelezionato.interessiAccumulati || 0)}`;

    alert(`✅ Tasso di interesse impostato al ${val}%.`);
}

// ========== ESPORTAZIONE/IMPORTAZIONE DATI ==========
function esportaDati() {
    const conti = ottieni_conti();
    const dati = {
        esportazione: new Date().toISOString(),
        conti: conti
    };
    
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumibank_dati.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('✅ Dati esportati con successo!');
}

function importaDati(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const dati = JSON.parse(e.target.result);
            if (!dati.conti || !Array.isArray(dati.conti)) {
                throw new Error('Formato file non valido');
            }
            
            // Conferma prima di sovrascrivere
            if (!confirm('⚠️ Questa azione sovrascriverà tutti i dati esistenti. Continuare?')) {
                return;
            }
            
            // Normalizza e salva
            const contiNormalizzati = dati.conti.map(normalizzaConto);
            localStorage.setItem('lumibank_conti', JSON.stringify(contiNormalizzati));
            salvaContiIndexedDB(contiNormalizzati).catch(console.error);
            
            alert('✅ Dati importati con successo!');
            location.reload(); // Ricarica per aggiornare l'interfaccia
        } catch (error) {
            alert('❌ Errore nell\'importazione: ' + error.message);
        }
    };
    reader.readAsText(file);
    
    // Reset input per permettere re-import
    event.target.value = '';
}

// Inizializzazione
document.addEventListener('DOMContentLoaded', async function() {
    // Inizializza EmailJS
    console.log('EmailJS disponibile:', typeof emailjs !== 'undefined');
    if (typeof emailjs !== 'undefined' && emailjs.init) {
        emailjs.init(EMAILJS_PUBLIC_KEY);
        console.log('EmailJS inizializzato con chiave pubblica:', EMAILJS_PUBLIC_KEY);
    }

    // Inizializza IndexedDB
    try {
        await initDB();
        console.log('IndexedDB inizializzato con successo');
    } catch (error) {
        console.error('Errore inizializzazione IndexedDB:', error);
    }

    // Ripristina sessione cliente se esiste
    const savedSessionMode = sessionStorage.getItem('lumibank_sessionMode');
    const savedClienteId = sessionStorage.getItem(CLIENT_SESSION_KEY);
    if (savedSessionMode === 'cliente' && savedClienteId) {
        currentClienteId = savedClienteId;
        sessionMode = 'cliente';
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        aggiornaModalitaApp();
        caricaDashboard();
    }

    // Imposta data massima oggi per tutti i campi data di nascita
    const oggi = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.max = oggi;
    });

    // Ripristina preferenza dark mode
    if (localStorage.getItem('lumibank_darkMode') === '1') {
        document.body.classList.add('dark-mode');
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) toggle.checked = true;
    }
});

function toggleDarkMode(attivo) {
    document.body.classList.toggle('dark-mode', attivo);
    localStorage.setItem('lumibank_darkMode', attivo ? '1' : '0');
    if (sessionMode === 'cliente' && !document.getElementById('dashboardSection').classList.contains('hidden')) {
        caricaDashboard();
    }
}