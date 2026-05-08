/**
 * 手谈等级分前端代理
 * 通过 Cloudflare Worker 代理访问手谈网站
 */

class ShoutanProxy {
    constructor(options = {}) {
        this.proxyUrl = options.proxyUrl || 'https://api.weiqi.lol';
        this.timeout = options.timeout || 30000;
        this.baseUrl = 'https://v.dzqzd.com/SpBody.aspx';
    }

    /**
     * 通过代理发送请求
     */
    async fetch(url) {
        const proxyFullUrl = `${this.proxyUrl}/?url=${encodeURIComponent(url)}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            const response = await fetch(proxyFullUrl, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            throw error;
        }
    }

    /**
     * 查询选手等级分
     * @param {string} name - 选手姓名
     * @returns {Promise<Object>} 查询结果
     */
    async query(name) {
        // 构造查询参数
        const xml = `<Redi Ns="Sp" Jk="选手查询" 姓名="${name}"/>`;
        const encoded = btoa(unescape(encodeURIComponent(xml)));
        const url = `${this.baseUrl}?r=${encoded}`;
        
        // 发送请求
        const html = await this.fetch(url);
        
        // 解析 HTML
        const players = this.parseHtml(html, name);
        
        return {
            found: players.length > 0,
            count: players.length,
            name: name,
            players: players
        };
    }

    /**
     * 解析 HTML 内容
     */
    parseHtml(html, name) {
        const players = [];
        
        // 检查是否是单个选手（DataTxt 变量）
        const datatxtMatch = html.match(/var DataTxt = ['"](<PkList>.*?<\/PkList>)['"];/s);
        if (datatxtMatch) {
            const xmlContent = datatxtMatch[1];
            
            // 从 RediTxt 提取 Yh
            let yh = '';
            const reditxtMatch = html.match(/var RediTxt = ['"]<Redi[^>]*Yh="(\d+)"[^>]*\/>['"];/);
            if (reditxtMatch) {
                yh = reditxtMatch[1];
            }
            
            // 解析 <Xs ... /> 属性（注意：斜杠前可能有空格）
            const xsPattern = /<Xs\s+([^>]+)\s*\/>/g;
            let match;
            
            while ((match = xsPattern.exec(xmlContent)) !== null) {
                const attrs = this.parseAttributes(match[1]);
                
                if (attrs['编号']) {
                    players.push({
                        name: attrs['姓名'] || name,
                        region: attrs['地区'] || '',
                        province: attrs['省份'] || '',
                        title: attrs['称谓'] || '',
                        rating: parseFloat(attrs['等级分']) || 0,
                        rank: parseInt(attrs['全国排名']) || 0,
                        games: parseInt(attrs['对局次数']) || 0,
                        yh: yh,
                        id: attrs['编号']
                    });
                }
            }
            
            return players;
        }
        
        // 检查是否有多个选手
        if (html.includes('请确认您要查看的选手') || html.includes('onclick="ChooseQy')) {
            const pattern = /<tr[^>]*onclick="ChooseQy\((\d+),\s*'([^']+)'\)"[^>]*>.*?<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>.*?<\/tr>/gs;
            let match;
            
            while ((match = pattern.exec(html)) !== null) {
                const userId = match[1];
                const playerId = match[2];
                const nameCell = match[3];
                const region = match[4].trim();
                const title = match[5].trim();
                const rating = match[6].trim();
                const rank = match[7].trim();
                const games = match[8].trim();
                
                // 提取姓名（去除 HTML 标签）
                const cleanName = nameCell.replace(/<[^>]+>/g, '').trim();
                
                players.push({
                    name: cleanName,
                    region: region,
                    title: title,
                    rating: parseFloat(rating) || 0,
                    rank: parseInt(rank) || 0,
                    games: parseInt(games) || 0,
                    yh: userId,
                    id: playerId
                });
            }
        } else {
            // 检查是否未找到
            if (html.includes('未找到任何记录') || html.includes('找不到符合条件的数据')) {
                return [];
            }
            
            // 尝试从详情页解析（旧格式）
            const nameMatch = html.match(/姓名[:：]\s*<[^>]*>([^<]+)<\/td>/);
            const regionMatch = html.match(/地区[:：]\s*<[^>]*>([^<]+)<\/td>/);
            const titleMatch = html.match(/段位[:：]\s*<[^>]*>([^<]+)<\/td>/);
            const ratingMatch = html.match(/等级分[:：]\s*<[^>]*>([^<]+)<\/td>/);
            const rankMatch = html.match(/全国排名[:：]\s*<[^>]*>([^<]+)<\/td>/);
            const gamesMatch = html.match(/对局[:：]\s*<[^>]*>([^<]+)<\/td>/);
            
            if (nameMatch) {
                players.push({
                    name: nameMatch[1].trim(),
                    region: regionMatch ? regionMatch[1].trim() : '未知',
                    title: titleMatch ? titleMatch[1].trim() : '',
                    rating: ratingMatch ? parseFloat(ratingMatch[1].trim()) : 0,
                    rank: rankMatch ? parseInt(rankMatch[1].trim()) : 0,
                    games: gamesMatch ? parseInt(gamesMatch[1].trim()) : 0,
                    yh: '',
                    id: ''
                });
            }
        }
        
        return players;
    }

    /**
     * 解析 XML 属性
     */
    /**
     * 解析 XML 属性（支持中文属性名）
     */
    parseAttributes(attrString) {
        const attrs = {};
        // 使用更宽松的正则，支持中文属性名
        const pattern = /([^\s=]+)=['"]([^'"]*)['"]/g;
        let match;
        
        while ((match = pattern.exec(attrString)) !== null) {
            attrs[match[1]] = match[2];
        }
        
        return attrs;
    }

    /**
     * 生成选手详细记录链接
     */
    getDetailUrl(player) {
        if (!player.yh || !player.id) {
            return null;
        }
        
        const xml = `<Redi Ns="Sp" Jk="等级分明细" Yh="${player.yh}" 选手号="${player.id}"/>`;
        const encoded = btoa(unescape(encodeURIComponent(xml)));
        return `${this.baseUrl}?r=${encoded}`;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShoutanProxy;
}
