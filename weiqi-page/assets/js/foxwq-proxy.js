/**
 * 野狐围棋前端代理
 * 通过 Cloudflare Worker 代理访问野狐 API
 * 实现棋谱下载的前端化
 */

class FoxwqProxy {
    constructor(options = {}) {
        // 代理服务器地址
        this.proxyUrl = options.proxyUrl || 'https://api.weiqi.lol';
        // 调试模式
        this.debug = options.debug || false;
        // 请求超时（毫秒）
        this.timeout = options.timeout || 30000;
        // 性能统计
        this.perf = {
            total: 0,
            requests: 0,
            startTime: null
        };
    }

    /**
     * 通过代理发送 GET 请求
     */
    async fetch(url, params = {}) {
        const fullUrl = params ? `${url}?${new URLSearchParams(params)}` : url;
        const proxyFullUrl = `${this.proxyUrl}/?url=${encodeURIComponent(fullUrl)}`;
        
        const startTime = performance.now();
        this.perf.requests++;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await fetch(proxyFullUrl, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const elapsed = performance.now() - startTime;
            this.perf.total += elapsed;
            
            if (this.debug) {
                console.log(`[FoxwqProxy] ${url} - ${elapsed.toFixed(0)}ms`, data);
            }
            
            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            throw error;
        }
    }

    /**
     * 通过昵称查询用户信息
     * @param {string} nickname - 野狐昵称
     * @returns {Promise<Object>} 用户信息
     */
    async queryUserByName(nickname) {
        const url = 'https://newframe.foxwq.com/cgi/QueryUserInfoPanel';
        const params = {
            srcuid: 0,
            username: nickname
        };
        
        const data = await this.fetch(url, params);
        
        if (data.result !== 0) {
            const errorMsg = data.resultstr || data.errmsg || '未知错误';
            throw new Error(`查询用户失败: ${errorMsg}`);
        }
        
        const uid = String(data.uid || '').trim();
        if (!uid) {
            throw new Error('未找到该昵称对应的UID');
        }
        
        return {
            uid: uid,
            nickname: data.username || data.name || data.englishname || nickname,
            dan: data.dan || 0,
            total_win: data.totalwin || 0,
            total_lost: data.totallost || 0,
            total_equal: data.totalequal || 0
        };
    }

    /**
     * 获取棋谱列表
     * @param {string} uid - 用户 UID
     * @param {string} lastcode - 分页参数（默认 "0"）
     * @returns {Promise<Array>} 棋谱列表
     */
    async fetchChessList(uid, lastcode = "0") {
        const url = 'https://h5.foxwq.com/yehuDiamond/chessbook_local/YHWQFetchChessList';
        const params = {
            srcuid: 0,
            dstuid: uid,
            type: 1,
            lastcode: lastcode,
            searchkey: '',
            uin: uid
        };
        
        const data = await this.fetch(url, params);
        
        if (data.result !== 0) {
            const errorMsg = data.resultstr || '获取棋谱列表失败';
            throw new Error(errorMsg);
        }
        
        return data.chesslist || [];
    }

    /**
     * 下载单局 SGF
     * @param {string} chessid - 棋谱 ID
     * @returns {Promise<string>} SGF 内容
     */
    async fetchSGF(chessid) {
        const url = 'https://h5.foxwq.com/yehuDiamond/chessbook_local/YHWQFetchChess';
        const params = {
            chessid: chessid
        };
        
        const data = await this.fetch(url, params);
        
        if (data.result !== 0) {
            throw new Error(`下载棋谱失败: ${data.resultstr || '未知错误'}`);
        }
        
        return data.chess || '';
    }

    /**
     * 格式化段位显示
     */
    static formatDan(danValue) {
        if (danValue >= 100) {
            return `职业${danValue - 100}段`;
        } else if (danValue >= 24) {
            return `业${danValue - 20}段`;
        } else if (danValue >= 20) {
            return `业${danValue - 20}段`;
        } else if (danValue >= 10) {
            return `${danValue - 10}级`;
        } else {
            return `${danValue}级`;
        }
    }

    /**
     * 解析对局结果
     */
    static parseResult(winner, point, reason) {
        if (winner === 0) {
            return "和棋";
        }
        
        const winnerStr = winner === 1 ? "黑胜" : "白胜";
        
        if (reason === 1) {
            if (point > 0) {
                return `${winnerStr} ${point}子`;
            }
            return winnerStr;
        } else if (reason === 2) {
            return `${winnerStr} (超时)`;
        } else if (reason === 3) {
            return `${winnerStr} (中盘)`;
        } else if (reason === 4) {
            return `${winnerStr} (认输)`;
        } else {
            return winnerStr;
        }
    }

    /**
     * 获取性能统计
     */
    getPerf() {
        return {
            requests: this.perf.requests,
            totalTime: this.perf.total,
            avgTime: this.perf.requests > 0 ? this.perf.total / this.perf.requests : 0
        };
    }
}

// 导出（如果支持模块）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FoxwqProxy;
}
