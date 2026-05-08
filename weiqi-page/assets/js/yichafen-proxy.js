/**
 * 易查分业余段位前端代理
 * 通过 Cloudflare Worker 代理访问易查分网站
 */

class YichafenProxy {
    constructor(options = {}) {
        this.proxyUrl = options.proxyUrl || 'https://api.weiqi.lol';
        this.timeout = options.timeout || 30000;
    }

    /**
     * 查询选手业余段位
     * @param {string} name - 选手姓名
     * @returns {Promise<Object>} 查询结果
     */
    async query(name) {
        const url = `${this.proxyUrl}/yichafen/query?name=${encodeURIComponent(name)}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // 转换为统一的返回格式（与后端 API 兼容）
            return {
                found: data.found,
                data: data.found ? {
                    name: data.name,
                    level: data.level,
                    rating: data.rating,
                    total_rank: data.total_rank,
                    province_rank: data.province_rank,
                    city_rank: data.city_rank,
                    gender: data.gender,
                    birth_year: data.birth_year,
                    province: data.province,
                    city: data.city,
                    notes: data.notes,
                    query_time: data.query_time || 0
                } : null,
                error: data.error
            };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            throw error;
        }
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YichafenProxy;
}
