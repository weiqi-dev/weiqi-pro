/**
 * 云比赛网前端代理 - 完全前端实现
 * 通过 Cloudflare Worker 代理访问云比赛网 API
 * 不需要后端服务器，不消耗服务器资源
 */

class YunbisaiProxy {
    constructor(options = {}) {
        // 代理服务器地址
        this.proxyUrl = options.proxyUrl || 'https://api.weiqi.lol';
        // 是否启用调试
        this.debug = options.debug || false;
        // 请求超时（毫秒）
        this.timeout = options.timeout || 30000;
        // 进度回调函数（用于 UI 更新）
        this.onProgress = options.onProgress || null;
        // 性能统计
        this.perf = {
            total: 0,
            requests: 0,
            startTime: null
        };
        // 对阵数据缓存（按 groupId 缓存所有轮次数据）
        this.matchesCache = {};
    }

    /**
     * 通过代理发送请求
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
                console.log(`[YunbisaiProxy] ${url} - ${elapsed.toFixed(0)}ms`);
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
     * 获取比赛列表
     * @param {Object} options - 查询选项
     * @param {string} options.area - 地区名称
     * @param {number} options.month - 最近多少个月
     * @param {string} options.keyword - 关键词过滤
     * @param {number} options.pageSize - 每页数量
     */
    async getEvents(options = {}) {
        const {
            area = '',
            month = 1,
            keyword = '',
            pageSize = 100
        } = options;

        const params = {
            page: 1,
            eventType: 2, // 围棋
            month: month,
            PageSize: Math.min(pageSize, 200)
        };

        if (area) {
            params.areaNum = area;
        }

        const url = 'https://data-center.yunbisai.com/api/lswl-events';
        
        let allEvents = [];
        let matchedEvents = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages) {
            params.page = page;
            const data = await this.fetch(url, params);
            
            // 处理返回数据格式
            const rows = data.datArr?.rows || data.rows || [];
            allEvents = allEvents.concat(rows);

            // 关键词过滤
            if (keyword) {
                for (const row of rows) {
                    const title = row.title || '';
                    const city = row.city_name || '';
                    if (title.includes(keyword) || city.includes(keyword)) {
                        matchedEvents.push(row);
                    }
                }
            }

            totalPages = data.datArr?.TotalPage || data.TotalPage || 1;
            page++;
        }

        const resultEvents = keyword ? matchedEvents : allEvents;

        return {
            events: resultEvents.map(e => ({
                id: e.event_id,
                title: e.title,
                city: e.city_name,
                date: e.max_time ? e.max_time.substring(0, 10) : null,
                players: e.play_num
            })),
            total: resultEvents.length,
            perf: {
                requests: page - 1,
                elapsed: this.perf.total
            }
        };
    }

    /**
     * 获取比赛分组信息
     * @param {number} eventId - 比赛ID
     */
    async getGroups(eventId) {
        const url = 'https://open.yunbisai.com/api/event/feel/list';
        const params = {
            event_id: eventId,
            page: 1,
            pagesize: 500
        };

        try {
            const data = await this.fetch(url, params);
            
            if (data.error !== 0) {
                // API 返回错误，尝试从 HTML 解析
                return await this.getGroupsFromHtml(eventId);
            }

            const rows = data.datArr?.rows || [];
            
            return {
                groups: rows.map(g => ({
                    id: g.group_id,
                    name: g.groupname,
                    players: g.playernum || g.participant_count
                })),
                total: rows.length,
                source: 'api'
            };
        } catch (error) {
            // API 失败，尝试 HTML 解析
            return await this.getGroupsFromHtml(eventId);
        }
    }

    /**
     * 从 HTML 页面解析分组信息（备用方案）
     * @param {number} eventId - 比赛ID
     */
    async getGroupsFromHtml(eventId) {
        const url = `https://www.yunbisai.com/tpl/eventFeatures/eventDetail-${eventId}.html`;
        
        try {
            const proxyUrl = `${this.proxyUrl}/?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            const html = await response.text();
            
            // 解析 HTML 中的分组数据
            const groups = [];
            const seen = new Set();
            
            // 格式1: <li data-groupname="..."><a ... data-groupid="...">
            const pattern1 = /<li[^>]*data-groupname="([^"]+)"[^>]*>[^<]*<a[^>]*data-groupid="(\d+)"/g;
            let match;
            
            while ((match = pattern1.exec(html)) !== null) {
                const groupId = match[2];
                if (!seen.has(groupId)) {
                    seen.add(groupId);
                    groups.push({
                        id: parseInt(groupId),
                        name: match[1].trim(),
                        players: null
                    });
                }
            }
            
            // 格式2: <a data-groupname="..." data-groupid="...">
            const pattern2 = /<a[^>]*data-groupname="([^"]+)"[^>]*data-groupid="(\d+)"/g;
            while ((match = pattern2.exec(html)) !== null) {
                const groupId = match[2];
                if (!seen.has(groupId)) {
                    seen.add(groupId);
                    groups.push({
                        id: parseInt(groupId),
                        name: match[1].trim(),
                        players: null
                    });
                }
            }

            return {
                groups,
                total: groups.length,
                source: 'html'
            };
        } catch (error) {
            return {
                groups: [],
                total: 0,
                source: 'error',
                error: error.message
            };
        }
    }

    /**
     * 获取分组选手列表
     * @param {number} eventId - 比赛ID
     * @param {number} groupId - 分组ID
     */
    async getGroupPlayers(eventId, groupId) {
        const url = 'https://open.yunbisai.com/api/event/feel/list';
        const params = {
            event_id: eventId,
            group_id: groupId,
            page: 1,
            pagesize: 200
        };

        const data = await this.fetch(url, params);
        
        if (data.error !== 0) {
            return { players: [], total: 0 };
        }

        const rows = data.datArr?.rows || [];
        
        return {
            players: rows.map(p => ({
                id: p.participant_id,
                name: p.participantname,
                rank: p.rank_num,
                score: p.integral
            })),
            total: rows.length
        };
    }

    /**
     * 获取某轮对阵表
     * @param {number} groupId - 分组ID
     * @param {number} bout - 轮次
     */
    async getAgainstPlan(groupId, bout) {
        const url = 'https://api.yunbisai.com/request/Group/Againstplan';
        const params = {
            groupid: groupId,
            bout: bout
        };

        const data = await this.fetch(url, params);
        
        if (data.error !== 0) {
            return null;
        }

        return data.datArr || {};
    }

    /**
     * 获取分组所有轮次对阵
     * @param {number} groupId - 分组ID
     */
    async getAllRounds(groupId) {
        // 检查缓存
        if (this.matchesCache[groupId]) {
            const cached = this.matchesCache[groupId];
            return {
                matches: cached.allMatches,
                totalRounds: cached.totalRounds,
                completedRounds: cached.completedRounds
            };
        }
        
        // 先获取第1轮，得到总轮数
        this.onProgress && this.onProgress('加载第 1 轮对阵数据...', 10);
        const firstRound = await this.getAgainstPlan(groupId, 1);
        
        if (!firstRound) {
            return { matches: [], totalRounds: 0, completedRounds: 0 };
        }

        const totalRounds = parseInt(firstRound.total_bout) || 0;
        const allMatches = [];
        
        // 添加第1轮数据
        const firstRows = firstRound.rows || [];
        for (const row of firstRows) {
            row.bout = 1;
        }
        allMatches.push(...firstRows);

        // 统计已完成轮数
        let completedRounds = 0;
        
        // 获取所有轮次（包括未完成的）
        for (let bout = 2; bout <= totalRounds; bout++) {
            // 更新进度：10% - 80% 用于加载轮次数据
            const progress = 10 + Math.floor((bout - 1) / totalRounds * 70);
            this.onProgress && this.onProgress(`加载第 ${bout}/${totalRounds} 轮对阵数据...`, progress);
            
            const roundData = await this.getAgainstPlan(groupId, bout);
            
            if (!roundData) break;

            const rows = roundData.rows || [];
            
            // 检查该轮是否已完成
            const isCompleted = rows.some(m => 
                parseFloat(m.p1_score || 0) !== 0 || parseFloat(m.p2_score || 0) !== 0
            );
            
            if (isCompleted) {
                completedRounds++;
            }

            for (const row of rows) {
                row.bout = bout;
            }
            allMatches.push(...rows);
        }
        
        // 第1轮如果已完成，也计入
        const firstRoundCompleted = firstRows.some(m => 
            parseFloat(m.p1_score || 0) !== 0 || parseFloat(m.p2_score || 0) !== 0
        );
        if (firstRoundCompleted) {
            completedRounds++;
        }
        
        // 计算排名前更新进度
        this.onProgress && this.onProgress('计算排名数据...', 85);
        
        // 缓存所有轮次的对阵数据（按轮次分组）
        this.matchesCache[groupId] = {
            allMatches,
            totalRounds,
            completedRounds,
            byRound: {}
        };
        
        // 按轮次分组缓存
        for (const match of allMatches) {
            const round = match.bout;
            if (!this.matchesCache[groupId].byRound[round]) {
                this.matchesCache[groupId].byRound[round] = [];
            }
            this.matchesCache[groupId].byRound[round].push(match);
        }

        return {
            matches: allMatches,
            totalRounds,
            completedRounds
        };
    }

    /**
     * 计算排名
     * @param {Array} matches - 对阵数据
     * @param {string} mode - 排名模式：default 或 simple
     */
    calculateRanking(matches, mode = 'default') {
        const players = {};

        // 初始化选手
        for (const match of matches) {
            // 处理 p1
            const p1Id = match.p1id;
            const p1Name = match.p1;
            const p1Team = match.p1_teamname || '';
            
            if (p1Id && p1Name && !players[p1Id]) {
                players[p1Id] = this.createPlayer(p1Id, p1Name, p1Team);
            }

            // 处理 p2
            const p2Id = match.p2id;
            const p2Name = match.p2;
            const p2Team = match.p2_teamname || '';
            
            if (p2Id && p2Name && !players[p2Id]) {
                players[p2Id] = this.createPlayer(p2Id, p2Name, p2Team);
            }
        }

        // 处理每场比赛
        for (const match of matches) {
            const p1Id = match.p1id;
            const p2Id = match.p2id;
            const p1Name = match.p1 || '';
            const p2Name = match.p2 || '';
            const p1Score = parseFloat(match.p1_score) || 0;
            const p2Score = parseFloat(match.p2_score) || 0;
            const bout = match.bout || 0;

            // 判断对局是否已完成
            // 如果双方得分都是 0，认为对局未完成
            const gameCompleted = (p1Score !== 0 || p2Score !== 0);

            // 更新 p1
            if (p1Id && players[p1Id]) {
                this.updatePlayerStats(players[p1Id], p1Score, p2Id, p2Name, bout, gameCompleted);
            }

            // 更新 p2
            if (p2Id && players[p2Id]) {
                this.updatePlayerStats(players[p2Id], p2Score, p1Id, p1Name, bout, gameCompleted);
            }
        }

        // 计算对手分、累进分
        for (const pid in players) {
            const p = players[pid];
            
            // 对手分 = 所有对手最终积分的总和
            p.opponentScore = p.opponents.reduce((sum, oid) => {
                const opponentScore = players[oid]?.score || 0;
                return sum + opponentScore;
            }, 0);

            // 累进分
            p.progressiveScore = p.progressive.reduce((sum, s) => sum + s, 0);

            // 计算对手分逆减
            this.calculateReverseMinus(p, players);
        }

        // 排序
        const useProgressive = mode !== 'simple';
        let sortedPlayers = Object.values(players);

        if (useProgressive) {
            sortedPlayers.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.opponentScore !== a.opponentScore) return b.opponentScore - a.opponentScore;
                if (b.progressiveScore !== a.progressiveScore) return b.progressiveScore - a.progressiveScore;
                return this.compareReverseMinus(a, b);
            });
        } else {
            sortedPlayers.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.opponentScore !== a.opponentScore) return b.opponentScore - a.opponentScore;
                return this.compareReverseMinus(a, b);
            });
        }

        // 处理同分破同分显示
        this.processTieBreakDisplay(sortedPlayers, useProgressive);

        // 格式化输出（使用下划线命名，与后端 API 一致）
        return sortedPlayers.map((p, index) => {
            const record = `${p.wins}胜${p.losses}负${p.draws > 0 ? p.draws + '和' : ''}`;
            const playerData = {
                rank: index + 1,
                name: p.name,
                team: p.team || null,
                score: Math.floor(p.score),
                opponent_score: Math.floor(p.opponentScore),
                progressive_score: Math.floor(p.progressiveScore),
                record: record
            };
            
            // 添加对手分逆减显示
            if (p.reverseMinusDisplay) {
                playerData.opponent_score_reverse_minus = p.reverseMinusDisplay;
            }
            
            // 添加每轮对局详情
            if (p.games && p.games.length > 0) {
                playerData.games = p.games.sort((a, b) => a.round - b.round);
            }
            
            return playerData;
        });
    }

    /**
     * 创建选手对象
     */
    createPlayer(id, name, team) {
        return {
            id,
            name,
            team,
            wins: 0,
            losses: 0,
            draws: 0,
            score: 0,
            opponents: [],
            progressive: [],
            games: [],
            roundOpponents: [] // [{ bout, opponentId, opponentName }]
        };
    }

    /**
     * 更新选手战绩
     */
    updatePlayerStats(player, score, opponentId, opponentName, bout, gameCompleted) {
        if (opponentId && opponentName) {
            player.opponents.push(opponentId);
            player.roundOpponents.push({ bout, opponentId, opponentName });
        }

        let result;
        
        // 如果对局未完成，不计入胜负，结果为待定
        if (!gameCompleted) {
            result = '待定';
        } else if (score === 2) {
            player.wins++;
            result = '胜';
        } else if (score === 0) {
            player.losses++;
            result = '负';
        } else {
            player.draws++;
            result = '和';
        }

        player.score += score;
        player.progressive.push(player.score);
        player.games.push({
            round: bout,
            opponent: opponentName || '轮空',
            result
        });
    }

    /**
     * 计算对手分逆减
     */
    calculateReverseMinus(player, allPlayers) {
        // 按轮次排序
        const roundOpponents = [...player.roundOpponents].sort((a, b) => a.bout - b.bout);
        
        // 获取每轮对手的最终积分
        const roundScores = roundOpponents.map(r => ({
            bout: r.bout,
            score: allPlayers[r.opponentId]?.score || 0
        }));

        // 计算逆减序列
        player.reverseMinus = [];
        
        if (player.opponentScore > 0) {
            let cumulative = 0;
            // 从末轮开始
            for (let i = roundScores.length - 1; i >= 0; i--) {
                cumulative += roundScores[i].score;
                player.reverseMinus.push(player.opponentScore - cumulative);
            }
        }
    }

    /**
     * 比较逆减序列
     */
    compareReverseMinus(a, b) {
        const aReverse = a.reverseMinus || [];
        const bReverse = b.reverseMinus || [];
        
        for (let i = 0; i < Math.max(aReverse.length, bReverse.length); i++) {
            const aVal = aReverse[i] || 0;
            const bVal = bReverse[i] || 0;
            if (bVal !== aVal) return bVal - aVal;
        }
        return 0;
    }

    /**
     * 处理同分破同分显示
     */
    processTieBreakDisplay(players, useProgressive) {
        let i = 0;
        while (i < players.length) {
            // 找到同分组
            let j = i + 1;
            while (j < players.length) {
                const sameBasic = useProgressive
                    ? players[i].score === players[j].score &&
                      players[i].opponentScore === players[j].opponentScore &&
                      players[i].progressiveScore === players[j].progressiveScore
                    : players[i].score === players[j].score &&
                      players[i].opponentScore === players[j].opponentScore;
                
                if (sameBasic) j++;
                else break;
            }

            const group = players.slice(i, j);
            
            if (group.length > 1) {
                // 有同分，处理逆减显示
                const maxRounds = Math.max(...group.map(p => (p.reverseMinus || []).length));
                
                for (let round = 0; round < maxRounds; round++) {
                    const values = group.map(p => (p.reverseMinus || [])[round] || 0);
                    
                    // 检查是否能区分
                    if (new Set(values).size === group.length) {
                        // 可以区分
                        group.forEach((p, idx) => {
                            const val = Math.floor((p.reverseMinus || [])[round] || 0);
                            p.reverseMinusDisplay = `${round + 1}-${val}`;
                        });
                        break;
                    }
                }

                // 无法区分，使用最后一轮
                group.forEach(p => {
                    if (!p.reverseMinusDisplay) {
                        const reverse = p.reverseMinus || [];
                        if (reverse.length > 0) {
                            const val = Math.floor(reverse[reverse.length - 1]);
                            p.reverseMinusDisplay = `${reverse.length}-${val}`;
                        } else {
                            p.reverseMinusDisplay = '-';
                        }
                    }
                });
            } else {
                // 只有一人，不需要破同分
                group[0].reverseMinusDisplay = '';
            }

            i = j;
        }
    }

    /**
     * 获取分组排名
     * @param {number} groupId - 分组ID
     * @param {string} mode - 排名模式
     */
    async getRanking(groupId, mode = 'default') {
        const { matches, totalRounds, completedRounds } = await this.getAllRounds(groupId);
        
        if (matches.length === 0) {
            return {
                rankings: [],
                totalRounds: 0,
                completedRounds: 0
            };
        }

        const rankings = this.calculateRanking(matches, mode);

        return {
            rankings,
            total_rounds: totalRounds,
            completed_rounds: completedRounds
        };
    }

    /**
     * 获取对阵表
     * @param {number} groupId - 分组ID
     * @param {number} bout - 轮次
     */
    async getMatches(groupId, bout = 1) {
        // 检查缓存
        if (this.matchesCache[groupId] && this.matchesCache[groupId].byRound[bout]) {
            const cached = this.matchesCache[groupId];
            const rows = cached.byRound[bout];
            
            return {
                matches: rows.map(m => ({
                    table: m.seatnum,
                    black: m.p1 || '轮空',
                    white: m.p2 || '轮空',
                    black_score: m.p1_score ? Math.floor(parseFloat(m.p1_score)) : null,
                    white_score: m.p2_score ? Math.floor(parseFloat(m.p2_score)) : null,
                    black_integral: m.p1_integral ? Math.floor(parseFloat(m.p1_integral)) : null,
                    white_integral: m.p2_integral ? Math.floor(parseFloat(m.p2_integral)) : null,
                    result: this.getMatchResult(m.p1_score, m.p2_score)
                })),
                totalRounds: cached.totalRounds,
                round: bout
            };
        }
        
        // 没有缓存，从 API 获取
        const data = await this.getAgainstPlan(groupId, bout);
        
        if (!data) {
            return {
                matches: [],
                totalRounds: 0,
                round: bout
            };
        }

        const rows = data.rows || [];
        const totalRounds = parseInt(data.total_bout) || 0;

        return {
            matches: rows.map(m => ({
                table: m.seatnum,
                black: m.p1 || '轮空',
                white: m.p2 || '轮空',
                black_score: m.p1_score ? Math.floor(parseFloat(m.p1_score)) : null,
                white_score: m.p2_score ? Math.floor(parseFloat(m.p2_score)) : null,
                black_integral: m.p1_integral ? Math.floor(parseFloat(m.p1_integral)) : null,
                white_integral: m.p2_integral ? Math.floor(parseFloat(m.p2_integral)) : null,
                result: this.getMatchResult(m.p1_score, m.p2_score)
            })),
            totalRounds,
            round: bout
        };
    }

    /**
     * 获取对局结果
     */
    getMatchResult(p1Score, p2Score) {
        const s1 = parseFloat(p1Score) || 0;
        const s2 = parseFloat(p2Score) || 0;
        
        if (s1 === 0 && s2 === 0) return null;
        if (s1 > s2) return '黑胜';
        if (s2 > s1) return '白胜';
        return '平局';
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YunbisaiProxy;
}
