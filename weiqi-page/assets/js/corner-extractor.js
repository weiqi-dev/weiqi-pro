/**
 * 四角定式提取器
 * 基于连通块检测的四角定式提取
 * 参考 Python 版本：weiqi-joseki/src/extraction/component_detector.py
 */

// 检测环境并导入依赖
if (typeof module !== 'undefined' && typeof require !== 'undefined') {
    // Node.js 环境：将 CoordinateConverter 添加到全局作用域
    global.CoordinateConverter = require('./coordinate-converter.js');
}

class CornerExtractor {
    /**
     * 提取四个角的着法
     * @param {Array} moves - 主分支着法 [(color, coord), ...]
     * @param {number} firstN - 只取前N手
     * @param {Array} handicapStones - 预置子 [{x, y, color}, ...]
     * @returns {Object} {tl: [...], tr: [...], bl: [...], br: [...], handicap: {tl: [...], tr: [...], bl: [...], br: [...]}}
     */
    extractFourCorners(moves, firstN = 80, handicapStones = []) {
        const limitedMoves = moves.slice(0, firstN);
        const result = {};
        const handicapResult = {};
        
        // 先将预置子分配到各个角
        const handicapByCorner = this._distributeHandicapStones(handicapStones);
        
        for (const cornerKey of ['tl', 'tr', 'bl', 'br']) {
            const cornerHandicap = handicapByCorner[cornerKey] || [];
            const cornerMoves = this.extractCorner(limitedMoves, cornerKey, cornerHandicap);
            if (cornerMoves && cornerMoves.length >= 2) {
                result[cornerKey] = cornerMoves;
            }
            // 保存每个角的预置子信息
            if (cornerHandicap.length > 0) {
                handicapResult[cornerKey] = cornerHandicap;
            }
        }
        
        // 如果有预置子，也返回预置子信息
        if (Object.keys(handicapResult).length > 0) {
            result.handicap = handicapResult;
        }
        
        return result;
    }
    
    /**
     * 将预置子分配到各个角
     * @param {Array} handicapStones - [{x, y, color}, ...]
     * @returns {Object} {tl: [...], tr: [...], bl: [...], br: [...]}
     */
    _distributeHandicapStones(handicapStones) {
        const result = { tl: [], tr: [], bl: [], br: [] };
        
        // 13路范围配置
        const cornerRanges = {
            tl: { colRange: [0, 12], rowRange: [0, 12] },
            tr: { colRange: [6, 18], rowRange: [0, 12] },
            bl: { colRange: [0, 12], rowRange: [6, 18] },
            br: { colRange: [6, 18], rowRange: [6, 18] }
        };
        
        for (const stone of handicapStones) {
            const { x, y, color } = stone;
            
            // 检查属于哪个角
            for (const [cornerKey, range] of Object.entries(cornerRanges)) {
                const [colMin, colMax] = range.colRange;
                const [rowMin, rowMax] = range.rowRange;
                
                if (x >= colMin && x <= colMax && y >= rowMin && y <= rowMax) {
                    result[cornerKey].push(stone);
                    break; // 一个子只属于一个角
                }
            }
        }
        
        return result;
    }
    
    /**
     * 提取单个角的着法（含脱先标记）
     * @param {Array} moves - [(color, coord), ...] 完整着法序列
     * @param {string} cornerKey - 角标识 ('tl', 'tr', 'bl', 'br')
     * @param {Array} handicapStones - 该角的预置子 [{x, y, color}, ...]
     * @returns {Array} 处理后的着法序列(含tt脱先标记)
     */
    extractCorner(moves, cornerKey, handicapStones = []) {
        // 定义四角的13路范围和角的原点
        const cornerConfig = {
            tl: { colRange: [0, 12], rowRange: [0, 12], origin: [0, 0] },
            tr: { colRange: [6, 18], rowRange: [0, 12], origin: [18, 0] },
            bl: { colRange: [0, 12], rowRange: [6, 18], origin: [0, 18] },
            br: { colRange: [6, 18], rowRange: [6, 18], origin: [18, 18] }
        };
        
        const config = cornerConfig[cornerKey];
        if (!config) return [];
        
        const [colMin, colMax] = config.colRange;
        const [rowMin, rowMax] = config.rowRange;
        
        // 多级回退策略: 13路 → 11路 → 9路
        // 1. 先尝试13路
        const result13 = this._extractCornerMovesLu(moves, cornerKey, 13, handicapStones);
        
        // 检查13路是否需要回退（被剔除的着法在凸包内）
        const shouldFallback13 = this._shouldFallback(result13);
        
        if (!shouldFallback13) {
            return result13.moves;
        }
        
        // 2. 回退到11路
        const result11 = this._extractCornerMovesLu(moves, cornerKey, 11, handicapStones);
        const shouldFallback11 = this._shouldFallback(result11);
        
        if (!shouldFallback11) {
            return result11.moves;
        }
        
        // 3. 最终回退到9路
        return this._extractCornerMoves9Lu(moves, cornerKey, handicapStones);
    }
    
    /**
     * 通用N路角提取
     * @param {Array} moves - 主分支着法
     * @param {string} cornerKey - 角标识
     * @param {number} luSize - 路数
     * @param {Array} handicapStones - 该角的预置子 [{x, y, color}, ...]
     * @returns {Object} {moves, corePositions, discardedPositions}
     */
    _extractCornerMovesLu(moves, cornerKey, luSize, handicapStones = []) {
        // N路范围配置
        const ranges = {
            9: {
                tl: [[0, 8], [0, 8]],
                tr: [[10, 18], [0, 8]],
                bl: [[0, 8], [10, 18]],
                br: [[10, 18], [10, 18]]
            },
            11: {
                tl: [[0, 10], [0, 10]],
                tr: [[8, 18], [0, 10]],
                bl: [[0, 10], [8, 18]],
                br: [[8, 18], [8, 18]]
            },
            13: {
                tl: [[0, 12], [0, 12]],
                tr: [[6, 18], [0, 12]],
                bl: [[0, 12], [6, 18]],
                br: [[6, 18], [6, 18]]
            }
        };
        
        const config = ranges[luSize]?.[cornerKey];
        if (!config) {
            return { moves: [], corePositions: new Set(), discardedPositions: new Set() };
        }
        
        const [[colMin, colMax], [rowMin, rowMax]] = config;
        
        // 收集N路范围内的着法
        const cornerMoves = [];
        
        let loopCount = 0;
        let validCoordCount = 0;
        let inRangeCount = 0;
        
        for (const [color, coord] of moves) {
            loopCount++;
            if (coord === 'tt' || !coord || coord.length !== 2) continue;
            validCoordCount++;
            
            try {
                const [col, row] = CoordinateConverter.sgfToNums(coord);
                if (col >= colMin && col <= colMax && row >= rowMin && row <= rowMax) {
                    inRangeCount++;
                    cornerMoves.push([color, coord, col, row]);
                }
            } catch (e) {
                continue;
            }
        }
        
        
        if (cornerMoves.length === 0) {
            return { moves: [], corePositions: new Set(), discardedPositions: new Set() };
        }
        
        // 收集所有位置
        const allPositions = new Set();
        for (const [color, coord, col, row] of cornerMoves) {
            allPositions.add(`${col},${row}`);
        }
        
        // 时序连通性分析
        const { corePositions, discardedPositions } = this._findTemporalCore(
            allPositions,
            cornerMoves,
            4,
            handicapStones
        );
        
        // 构建结果
        const result = [];
        let lastColor = null;
        
        // 先添加预置子作为初始着法
        // 预置子通常是黑子，需要插入白方的 pass 保持交替
        for (const stone of handicapStones) {
            // 转换为 SGF 坐标
            const coord = String.fromCharCode(97 + stone.x) + String.fromCharCode(97 + stone.y);
            
            // 如果上一个是黑子，插入白方的 pass
            if (lastColor === 'B') {
                result.push(['W', 'tt']);
            }
            
            result.push([stone.color, coord]);
            lastColor = stone.color;
        }
        
        for (const [color, coord, col, row] of cornerMoves) {
            const posKey = `${col},${row}`;
            if (corePositions.has(posKey)) {
                if (lastColor === color) {
                    const passColor = color === 'B' ? 'W' : 'B';
                    result.push([passColor, 'tt']);
                }
                result.push([color, coord]);
                lastColor = color;
            }
        }
        
        return {
            moves: result,
            corePositions,
            discardedPositions
        };
    }
    
    /**
     * 提取指定角的着法（9路范围，最终回退方案）
     * @param {Array} moves - 主分支着法
     * @param {string} cornerKey - 角标识
     * @param {Array} handicapStones - 该角的预置子 [{x, y, color}, ...]
     */
    _extractCornerMoves9Lu(moves, cornerKey, handicapStones = []) {
        // 9路范围配置
        const cornerConfig = {
            tl: { colRange: [0, 8], rowRange: [0, 8] },
            tr: { colRange: [10, 18], rowRange: [0, 8] },
            bl: { colRange: [0, 8], rowRange: [10, 18] },
            br: { colRange: [10, 18], rowRange: [10, 18] }
        };
        
        const config = cornerConfig[cornerKey];
        if (!config) return [];
        
        const [colMin, colMax] = config.colRange;
        const [rowMin, rowMax] = config.rowRange;
        
        // 收集9路范围内的着法（带时序）
        const cornerMovesList = [];
        
        for (const [color, coord] of moves) {
            if (coord === 'tt' || !coord || coord.length !== 2) continue;
            try {
                const [col, row] = CoordinateConverter.sgfToNums(coord);
                if (col >= colMin && col <= colMax && row >= rowMin && row <= rowMax) {
                    cornerMovesList.push([color, col, row, coord]);
                }
            } catch (e) {
                continue;
            }
        }
        
        if (cornerMovesList.length === 0 && handicapStones.length === 0) return [];
        
        // 时序过滤
        const activePositions = new Set();
        const corePositions = new Set();
        
        // 先添加预置子作为初始位置
        for (const stone of handicapStones) {
            const posKey = `${stone.x},${stone.y}`;
            activePositions.add(posKey);
            corePositions.add(posKey);
        }
        
        for (const [color, col, row, coord] of cornerMovesList) {
            if (activePositions.size === 0) {
                // 第一手
                activePositions.add(`${col},${row}`);
                corePositions.add(`${col},${row}`);
            } else {
                // 检查是否与活跃区域中任意一点在围棋连通距离内
                let isConnected = false;
                for (const posStr of activePositions) {
                    const [ac, ar] = posStr.split(',').map(Number);
                    if (CoordinateConverter.isGoConnected([col, row], [ac, ar])) {
                        isConnected = true;
                        break;
                    }
                }
                
                if (isConnected) {
                    activePositions.add(`${col},${row}`);
                    corePositions.add(`${col},${row}`);
                }
            }
        }
        
        if (corePositions.size === 0) return [];
        
        // 构建结果（检测脱先）
        const result = [];
        let lastColor = null;
        
        // 先添加预置子作为初始着法
        for (const stone of handicapStones) {
            // 转换为 SGF 坐标
            const coord = String.fromCharCode(97 + stone.x) + String.fromCharCode(97 + stone.y);
            
            // 如果上一个是黑子，插入白方的 pass
            if (lastColor === 'B') {
                result.push(['W', 'tt']);
            }
            
            result.push([stone.color, coord]);
            lastColor = stone.color;
        }
        
        for (const [color, col, row, coord] of cornerMovesList) {
            const posKey = `${col},${row}`;
            if (corePositions.has(posKey)) {
                if (lastColor === color) {
                    const passColor = color === 'B' ? 'W' : 'B';
                    result.push([passColor, 'tt']);
                }
                result.push([color, coord]);
                lastColor = color;
            }
        }
        
        return result;
    }
    
    /**
     * 基于行棋时序确定核心定式区域
     * @param {Set} positions - 所有位置集合
     * @param {Array} moves - 着法序列
     * @param {number} maxDistance - 最大距离
     * @param {Array} initialPositions - 初始位置（预置子）[{x, y}, ...]
     */
    _findTemporalCore(positions, moves, maxDistance = 4, initialPositions = []) {
        const corePositions = new Set();
        const discardedPositions = new Set();
        const activePositions = new Set();
        
        // 先添加预置子作为初始位置
        for (const pos of initialPositions) {
            const posKey = `${pos.x},${pos.y}`;
            activePositions.add(posKey);
            corePositions.add(posKey);
        }
        
        for (const [color, coord, col, row] of moves) {
            const posKey = `${col},${row}`;
            
            if (!positions.has(posKey)) continue;
            
            if (activePositions.size === 0) {
                // 第一手，加入核心
                activePositions.add(posKey);
                corePositions.add(posKey);
            } else {
                // 检查是否与活跃区域中任意一点在围棋连通距离内
                let isConnected = false;
                for (const activePos of activePositions) {
                    const [ac, ar] = activePos.split(',').map(Number);
                    if (CoordinateConverter.isGoConnected([col, row], [ac, ar])) {
                        isConnected = true;
                        break;
                    }
                }
                
                if (isConnected) {
                    activePositions.add(posKey);
                    corePositions.add(posKey);
                } else {
                    // 标记为脱先
                    discardedPositions.add(posKey);
                }
            }
        }
        
        return { corePositions, discardedPositions };
    }
    
    /**
     * 判断是否需要回退
     */
    _shouldFallback(result) {
        const { corePositions, discardedPositions } = result;
        
        if (discardedPositions.size === 0 || corePositions.size === 0) {
            return false;
        }
        
        // 计算凸包
        const corePoints = Array.from(corePositions).map(posStr => {
            const [x, y] = posStr.split(',').map(Number);
            return [x, y];
        });
        
        const hull = this._convexHull(corePoints);
        
        // 检查被剔除的点是否在凸包内
        for (const discPos of discardedPositions) {
            const [dx, dy] = discPos.split(',').map(Number);
            if (this._pointInPolygon([dx, dy], hull)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * 计算凸包（单调链算法）
     */
    _convexHull(points) {
        if (points.length <= 1) return points;
        
        // 去重并排序
        const unique = [];
        const seen = new Set();
        for (const p of points) {
            const key = `${p[0]},${p[1]}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(p);
            }
        }
        points = unique.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        
        if (points.length <= 2) return points;
        
        const cross = (o, a, b) => {
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        };
        
        // 下半部分
        const lower = [];
        for (const p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
        
        // 上半部分
        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
        
        // 合并（去掉重复端点）
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }
    
    /**
     * 判断点是否在多边形内（射线法，包含边界）
     */
    _pointInPolygon(point, polygon) {
        if (polygon.length === 0) return false;
        
        if (polygon.length === 1) {
            return point[0] === polygon[0][0] && point[1] === polygon[0][1];
        }
        
        if (polygon.length === 2) {
            // 线段：检查点是否在线段上
            const [x, y] = point;
            const [x1, y1] = polygon[0];
            const [x2, y2] = polygon[1];
            
            const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
            if (cross !== 0) return false;
            
            const dot = (x - x1) * (x - x2) + (y - y1) * (y - y2);
            return dot <= 0;
        }
        
        // 射线法
        const [x, y] = point;
        const n = polygon.length;
        let inside = false;
        
        for (let i = 0; i < n; i++) {
            const [x1, y1] = polygon[i];
            const [x2, y2] = polygon[(i + 1) % n];
            
            // 检查点是否在边上
            const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
            if (cross === 0) {
                // 检查是否在线段范围内
                if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) &&
                    y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) {
                    return true;
                }
            }
            
            // 射线交叉检查
            if ((y1 > y) !== (y2 > y)) {
                const intersectX = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
                if (x <= intersectX) {
                    inside = !inside;
                }
            }
        }
        
        return inside;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CornerExtractor;
}
