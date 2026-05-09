/**
 * 对手分析 Proxy 模块
 * 封装对手分析的 proxy 逻辑
 */

class OpponentProxy {
    /**
     * 分析对手（Proxy 模式）
     * 
     * @param {string} foxwqId - 野狐棋手昵称或 ID
     * @param {number} limit - 分析棋谱数量
     * @param {Function} progressCallback - 进度回调函数
     * @returns {Object} 分析结果
     */
    static async analyze(foxwqId, limit = 10, progressCallback = null) {
        const foxwqProxy = new FoxwqProxy();
        const sgfParser = new SGFParser();
        const cornerExtractor = new CornerExtractor();
        const basePath = typeof BASE_PATH !== 'undefined' ? BASE_PATH : '';
        const josekiMatcher = new JosekiMatcher(basePath + '/assets/data/joseki');
        
        // 步骤1: 查询用户信息
        if (progressCallback) {
            progressCallback(10, '查询用户信息...', `正在查询 ${foxwqId}`);
        }
        
        const userInfo = await foxwqProxy.queryUserByName(foxwqId);
        if (!userInfo || !userInfo.uid) {
            throw new Error('未找到该用户');
        }
        
        const uid = userInfo.uid;
        
        // 步骤2: 获取棋谱列表
        if (progressCallback) {
            progressCallback(20, '获取棋谱列表...', `正在获取最近 ${limit} 盘棋谱`);
        }
        
        const games = await foxwqProxy.fetchChessList(uid);
        if (!games || games.length === 0) {
            throw new Error('该用户没有公开的棋谱');
        }
        
        const gamesToAnalyze = games.slice(0, limit);
        
        // 步骤3: 下载并分析每个棋谱
        const allResults = [];
        const sgfDataMap = {};
        const totalGames = gamesToAnalyze.length;
        
        for (let i = 0; i < totalGames; i++) {
            const game = gamesToAnalyze[i];
            const progress = 20 + (i / totalGames) * 70;
            
            if (progressCallback) {
                progressCallback(
                    progress,
                    `分析棋谱 ${i + 1}/${totalGames}`,
                    `${game.blacknick || '黑棋'} vs ${game.whitenick || '白棋'} - ${game.starttime || game.date || '-'}`
                );
            }
            
            try {
                // 下载 SGF
                const sgfData = await foxwqProxy.fetchSGF(game.chessid);
                
                if (!sgfData) {
                    console.warn(`[Proxy] 棋谱 ${game.chessid} 下载失败`);
                    continue;
                }
                
                // 保存 SGF 数据
                sgfDataMap[game.chessid] = sgfData;
                
                // 解析 SGF
                const parsed = sgfParser.parse(sgfData);
                
                // 检查棋盘大小，跳过非19路棋谱
                if (parsed.game_info.board_size !== 19) {
                    console.log(`[Proxy] 棋谱 ${game.chessid} 不是19路棋盘 (${parsed.game_info.board_size}路)，跳过`);
                    continue;
                }
                
                const moves = sgfParser.extractMainBranch(parsed.tree, 80);
                
                if (!moves || moves.length === 0) {
                    console.warn(`[Proxy] 棋谱 ${game.chessid} 解析失败`);
                    continue;
                }
                
                // 提取四个角
                const corners = cornerExtractor.extractFourCorners(moves);
                
                // 匹配每个角
                for (const cornerKey of ['tl', 'tr', 'bl', 'br']) {
                    const cornerMoves = corners[cornerKey];
                    
                    if (!cornerMoves || cornerMoves.length < 2) {
                        continue;
                    }
                    
                    // 从元组数组中提取坐标字符串
                    const coords = cornerMoves.map(([color, coord]) => coord);
                    
                    // 转换到右上角
                    const trMoves = CoordinateConverter.convertToTopRight(coords, cornerKey);
                    
                    // 标准化
                    const normResult = CoordinateConverter.normalizeCornerSequence(trMoves);
                    const normalized = normResult.normalized;
                    
                    // 匹配定式
                    const result = await josekiMatcher.matchSequence(normalized);
                    
                    // 只记录有效的定式（freq > 0 且 4 手及以上）
                    if (result && result.freq > 0 && result.matchedCount >= 4) {
                        // 生成定式树 SGF
                        const treeSgf = await josekiMatcher.exportTree(
                            result.matched,  // prefix（匹配的前缀）
                            normalized,      // mainBranch（标准化后的着法串）
                            5                // limit（限制变化分支数量）
                        );
                        
                        allResults.push({
                            joseki_id: result.josekiId || `local_${Date.now()}`,
                            prefix: result.matched.join(' '),
                            prefix_len: result.matchedCount,
                            total_moves: result.totalCount,
                            source_corner: cornerKey,
                            frequency: result.freq || 0,
                            probability: result.prob || 0,
                            winrate_stats: result.winrate_stats || null,
                            extracted_moves: treeSgf,  // 使用生成的定式树 SGF
                            game_info: {
                                black: game.blacknick || '黑棋',
                                white: game.whitenick || '白棋',
                                date: (game.starttime || game.gameendtime || game.date || '-').split(' ')[0],
                                event: "",
                                result: game.result || ''
                            },
                            file: game.chessid || game.id
                        });
                    }
                }
                
            } catch (error) {
                console.error(`[Proxy] 棋谱 ${game.chessid} 分析失败:`, error);
            }
        }
        
        // 步骤4: 构造返回数据
        if (progressCallback) {
            progressCallback(95, '整理结果...', `发现 ${allResults.length} 个定式`);
        }
        
        // 按 prefix_len 从长到短排序（参考 Python cmd_discover）
        allResults.sort((a, b) => b.prefix_len - a.prefix_len);
        
        // 转换 games 数据格式
        const formattedGames = gamesToAnalyze.map(game => {
            const parseResult = (winner, point, reason) => {
                if (winner === 0) return "和棋";
                const winnerStr = winner === 1 ? "黑胜" : "白胜";
                if (reason === 1) return point > 0 ? `${winnerStr}` : winnerStr;
                if (reason === 2) return `${winnerStr}`;
                if (reason === 3) return `${winnerStr}`;
                if (reason === 4) return `${winnerStr}`;
                return winnerStr;
            };
            
            return {
                black: game.blacknick || '黑棋',
                white: game.whitenick || '白棋',
                date: (game.starttime || game.gameendtime || game.date || '-').split(' ')[0],
                file: game.chessid || game.id,
                opponent: game.blacknick === foxwqId ? (game.whitenick || '白棋') : (game.blacknick || '黑棋'),
                result: parseResult(game.winner || 0, game.point || 0, game.reason || 0),
                sgf: sgfDataMap[game.chessid] || null
            };
        });
        
        // 构造最终结果
        const result = {
            error: null,
            foxwq_id: foxwqId,
            games: formattedGames,
            joseki: {
                count: allResults.length,
                results: allResults
            }
        };
        
        if (progressCallback) {
            progressCallback(100, '完成！', '');
        }
        
        return result;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpponentProxy;
}
