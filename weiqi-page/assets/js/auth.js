/**
 * 统一认证工具函数
 * 提供 Token 管理和带认证的请求
 */

const TOKEN_KEY = 'weiqi_token';

// GitHub Pages 上的域名配置
const DOMAIN_JS_URL = 'https://weiqi-dev.github.io/weiqi-assets/js/domain.js';
const DOMAIN_CACHE_KEY = 'weiqi_api_domain';
const DOMAIN_CACHE_TIME_KEY = 'weiqi_api_domain_time';
const CACHE_MAX_AGE = 10 * 60 * 1000; // 10分钟缓存

// 动态 API_BASE（通过 getApiBase() 获取）
async function getApiBase() {
    // 1. 检查内存缓存
    if (window.API_BASE) {
        return window.API_BASE;
    }
    
    // 2. 检查 localStorage 缓存（未过期）
    const cached = localStorage.getItem(DOMAIN_CACHE_KEY);
    const cachedTime = parseInt(localStorage.getItem(DOMAIN_CACHE_TIME_KEY) || '0');
    const now = Date.now();
    
    if (cached && (now - cachedTime) < CACHE_MAX_AGE) {
        return cached;
    }
    
    // 3. 从 GitHub Pages 加载最新配置
    try {
        await loadScript(DOMAIN_JS_URL + '?v=' + now);
        if (window.API_BASE) {
            // 缓存到 localStorage
            localStorage.setItem(DOMAIN_CACHE_KEY, window.API_BASE);
            localStorage.setItem(DOMAIN_CACHE_TIME_KEY, now.toString());
            return window.API_BASE;
        }
    } catch (e) {
        console.warn('加载域名配置失败:', e);
    }
    
    // 4. 使用过期缓存（降级）
    if (cached) {
        return cached;
    }
    
    throw new Error('无法获取 API 域名，请检查网络连接或稍后刷新页面重试');
}

// 动态加载 JS 文件（支持跨域）
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = (e) => reject(new Error('Failed to load: ' + src));
        document.head.appendChild(script);
    });
}

// 检查字符串是否包含非 ISO-8859-1 字符
function hasInvalidChars(str) {
    if (!str) return false;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 255) return true;
    }
    return false;
}

/**
 * 获取 Token（从 localStorage）
 * @returns {string} Token 或空字符串
 */
function getToken() {
    try {
        const token = localStorage.getItem(TOKEN_KEY);
        // 检测 Token 是否包含非法字符（如中文），有则清除
        if (token && hasInvalidChars(token)) {
            clearToken();
            return '';
        }
        return token || '';
    } catch (e) {
        return '';
    }
}

/**
 * 保存 Token
 * @param {string} token 
 */
function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

/**
 * 清除 Token
 */
function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

/**
 * 检查是否有 Token
 * @returns {boolean}
 */
function hasToken() {
    return !!getToken();
}

/**
 * 跳转到认证页面
 * @param {string} returnUrl - 认证成功后返回的页面（默认当前页面）
 */
function redirectToAuth(returnUrl) {
    const url = returnUrl || window.location.href;
    const encodedReturnUrl = encodeURIComponent(url);
    setTimeout(() => {
        window.location.replace(`/weiqi-page/auth.html?return=${encodedReturnUrl}`);
    }, 10);
}

/**
 * 带认证的 Fetch 请求
 * 自动添加 Token 到请求头，自动处理 401 错误
 * 
 * @param {string} url - 请求路径（不含域名，如 /api/v1/yunbisai/events）
 * @param {object} options - fetch 选项
 * @returns {Promise<Response|null>} 如果返回 null 表示已跳转
 */
async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    const apiBase = await getApiBase();
    const fullUrl = url.startsWith('http') ? url : `${apiBase}${url}`;
    
    // 添加认证头
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    
    try {
        const response = await fetch(fullUrl, {
            ...options,
            headers
        });
        
        // 401/403 跳转到认证页面
        if (response.status === 401 || response.status === 403) {
            clearToken();
            setTimeout(() => {
                redirectToAuth(window.location.href);
            }, 0);
            return null;
        }
        
        return response;
    } catch (error) {
        throw new Error('网络请求失败，请检查网络连接');
    }
}

/**
 * 验证 Token 是否有效
 * @param {string} token 
 * @returns {Promise<boolean>}
 */
async function validateToken(token) {
    try {
        const apiBase = await getApiBase();
        const response = await fetch(`${apiBase}/api/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * 初始化页面（自动检查 Token）
 * 如果页面需要 Token 但用户没有，自动跳转
 * 
 * @param {boolean} requireAuth - 是否强制需要 Token
 * @returns {Promise<boolean>} 是否有 Token
 */
async function initAuth(requireAuth = true) {
    if (requireAuth && !hasToken()) {
        redirectToAuth();
        return false;
    }
    // 预加载域名
    try {
        await getApiBase();
    } catch (e) {
        console.warn('预加载域名失败:', e);
    }
    return true;
}
