/**
 * EngineeringPortal - 客戶與機種中央資料庫核心模組
 */
const STORAGE_KEY_PROJECTS = 'rd_portal_customer_models';

// 內建預設客戶與機種清單（當 LocalStorage 尚無資料時使用）
const DEFAULT_CUSTOMER_MODELS = {
    "Nexteer": ["31xx-2", "C1xx-2", "VSS", "Fiasa", "mCEPS", "無"],
    "ZF": ["ERC", "AKC", "IBC2", "EMB", "EPBr", "SCA", "C1+", "IBC3", "BD", "TRW", "NEP3", "無"],
    "Bosch": ["SCU4", "IPB", "無"],
    "TKP": ["SbW", "ICA3", "BL2B3", "C4.36", "C5.3", "無"],
    "JD": ["CCE2", "無"],
    "BHAP": ["HBS", "無"],
    "BIBO": ["無"],
    "BRP-Helium": ["無"],
    "Johnson Outdoors": ["無"],
    "無": ["無"]
};

// 讀取最新專案對應表
function getProjectData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PROJECTS);
        if (!raw) {
            localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(DEFAULT_CUSTOMER_MODELS));
            return JSON.parse(JSON.stringify(DEFAULT_CUSTOMER_MODELS));
        }
        return JSON.parse(raw);
    } catch (e) {
        console.error("讀取 LocalStorage 失敗，套用預設資料", e);
        return DEFAULT_CUSTOMER_MODELS;
    }
}

// 寫入最新專案對應表
function saveProjectData(data) {
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(data));
    window.dispatchEvent(new Event('storage'));
}

// 填充客戶下拉選單
function populateCustomerDropdown(customerSelectId) {
    const custSelect = document.getElementById(customerSelectId);
    if (!custSelect) return;
    const currentVal = custSelect.value;
    const data = getProjectData();

    custSelect.innerHTML = '';
    Object.keys(data).forEach(cust => {
        const opt = new Option(cust, cust);
        custSelect.appendChild(opt);
    });

    if (Array.from(custSelect.options).some(o => o.value === currentVal)) {
        custSelect.value = currentVal;
    }
}

// 根據客戶選取連動更新機種選單
function updateModelDropdown(customerSelectId, modelSelectId) {
    const custSelect = document.getElementById(customerSelectId);
    const modelSelect = document.getElementById(modelSelectId);
    if (!custSelect || !modelSelect) return;

    const data = getProjectData();
    const selectedCust = custSelect.value;
    const models = data[selectedCust] || ["無"];
    const currentVal = modelSelect.value;

    modelSelect.innerHTML = '';
    models.forEach(m => {
        const opt = new Option(m, m);
        modelSelect.appendChild(opt);
    });

    if (Array.from(modelSelect.options).some(o => o.value === currentVal)) {
        modelSelect.value = currentVal;
    } else if (modelSelect.options.length > 0) {
        modelSelect.selectedIndex = 0;
    }
}
