/**
 * 坐标转换器
 * 支持 SGF 坐标和 ruld 坐标系之间的转换
 * 参考 Python 版本：weiqi-joseki/src/core/coords.py
 */

class CoordinateConverter {
    /**
     * SGF 坐标转数字坐标
     * @param {string} sgf - SGF 坐标（如 'pd'）
     * @returns {Array} [col, row]
     */
    static sgfToNums(sgf) {
        if (!sgf || sgf.length !== 2) {
            throw new Error(`Invalid SGF coordinate: ${sgf}`);
        }
        return [sgf.charCodeAt(0) - 97, sgf.charCodeAt(1) - 97];
    }
    
    /**
     * 数字坐标转 SGF 坐标
     * @param {number} col - 列号
     * @param {number} row - 行号
     * @returns {string} SGF 坐标
     */
    static numsToSgf(col, row) {
        return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
    }
    
    /**
     * 转换到 ruld 坐标系（右上角原点，x 向左，y 向下）
     * @param {string} coord - 原 SGF 坐标
     * @param {string} cornerKey - 角标识 ('tl', 'tr', 'bl', 'br')
     * @returns {Array} [x_ruld, y_ruld]
     */
    static toRuld(coord, cornerKey) {
        if (!coord || coord === 'tt' || coord === 'pass') {
            return coord; // pass 保持不变
        }
        
        const [col, row] = this.sgfToNums(coord);
        
        switch (cornerKey) {
            case 'tl': // 左上角 → ruld（水平翻转）
                return [18 - col, row];
            
            case 'tr': // 右上角 → ruld（偏移到原点）
                return [col - 6, row];
            
            case 'bl': // 左下角 → ruld（旋转90°）
                return [row - 6, col];
            
            case 'br': // 右下角 → ruld（水平翻转 + 偏移）
                return [18 - col, row - 6];
            
            default:
                throw new Error(`Unknown corner: ${cornerKey}`);
        }
    }
    
    /**
     * 从 ruld 坐标系转换回 SGF 坐标
     * @param {Array} ruldCoord - ruld 坐标 [x, y]
     * @param {string} cornerKey - 角标识 ('tl', 'tr', 'bl', 'br')
     * @returns {string} SGF 坐标
     */
    static fromRuld(ruldCoord, cornerKey) {
        if (typeof ruldCoord === 'string') {
            return ruldCoord; // pass 保持不变
        }
        
        const [x, y] = ruldCoord;
        let col, row;
        
        switch (cornerKey) {
            case 'tl': // ruld → 左上角
                col = 18 - x;
                row = y;
                break;
            
            case 'tr': // ruld → 右上角
                col = x + 6;
                row = y;
                break;
            
            case 'bl': // ruld → 左下角
                col = y;
                row = x + 6;
                break;
            
            case 'br': // ruld → 右下角
                col = 18 - x;
                row = y + 6;
                break;
            
            default:
                throw new Error(`Unknown corner: ${cornerKey}`);
        }
        
        return this.numsToSgf(col, row);
    }
    
    /**
     * 批量转换着法到 ruld 坐标系
     * @param {Array} moves - [(color, coord), ...]
     * @param {string} cornerKey - 角标识
     * @returns {Array} [(color, [x, y] 或 'tt'), ...]
     */
    static convertMovesToRuld(moves, cornerKey) {
        return moves.map(([color, coord]) => {
            if (coord === 'tt' || coord === 'pass' || !coord) {
                return [color, coord]; // pass 保持不变
            }
            const ruldCoord = this.toRuld(coord, cornerKey);
            return [color, ruldCoord];
        });
    }
    
    /**
     * 批量从 ruld 坐标系转换回 SGF 坐标
     * @param {Array} ruldMoves - [(color, [x, y] 或 'tt'), ...]
     * @param {string} cornerKey - 角标识
     * @returns {Array} [(color, coord), ...]
     */
    static convertMovesFromRuld(ruldMoves, cornerKey) {
        return ruldMoves.map(([color, coord]) => {
            if (coord === 'tt' || coord === 'pass' || !coord) {
                return [color, coord]; // pass 保持不变
            }
            const sgfCoord = this.fromRuld(coord, cornerKey);
            return [color, sgfCoord];
        });
    }
    
    /**
     * 判断点是否在围棋连通距离内
     * 围棋连通距离定义：
     * - 单向距离 max(|dx|, |dy|) <= 4
     * - 总距离 |dx| + |dy| <= 5
     * 
     * @param {Array} p1 - 点1 [x, y]
     * @param {Array} p2 - 点2 [x, y]
     * @returns {boolean} 是否连通
     */
    static isGoConnected(p1, p2) {
        const dx = Math.abs(p1[0] - p2[0]);
        const dy = Math.abs(p1[1] - p2[1]);
        return dx <= 4 && dy <= 4 && dx + dy <= 5;
    }
    
    /**
     * 检测着法属于哪个角
     * @param {Array} moves - 坐标列表
     * @param {number} cornerSize - 角大小（9/11/13）
     * @returns {string|null} 角标识 ('tl', 'tr', 'bl', 'br')
     */
    static detectCorner(moves, cornerSize = 9) {
        const validCoords = moves.filter(m => m && m !== 'pass' && m !== 'tt' && m.length === 2);
        if (validCoords.length === 0) return null;
        
        const cornerCounts = { tl: 0, tr: 0, bl: 0, br: 0 };
        
        for (const coord of validCoords) {
            try {
                const [col, row] = this.sgfToNums(coord);
                
                if (cornerSize === 9) {
                    if (col <= 8 && row <= 8) cornerCounts.tl++;
                    else if (col >= 10 && row <= 8) cornerCounts.tr++;
                    else if (col <= 8 && row >= 10) cornerCounts.bl++;
                    else if (col >= 10 && row >= 10) cornerCounts.br++;
                } else if (cornerSize === 11) {
                    if (col <= 10 && row <= 10) cornerCounts.tl++;
                    else if (col >= 8 && row <= 10) cornerCounts.tr++;
                    else if (col <= 10 && row >= 8) cornerCounts.bl++;
                    else if (col >= 8 && row >= 8) cornerCounts.br++;
                } else { // 13路
                    if (col <= 12 && row <= 12) cornerCounts.tl++;
                    else if (col >= 6 && row <= 12) cornerCounts.tr++;
                    else if (col <= 12 && row >= 6) cornerCounts.bl++;
                    else if (col >= 6 && row >= 6) cornerCounts.br++;
                }
            } catch (e) {
                continue;
            }
        }
        
        // 找出数量最多的角
        let maxCorner = null;
        let maxCount = 0;
        for (const [corner, count] of Object.entries(cornerCounts)) {
            if (count > maxCount) {
                maxCount = count;
                maxCorner = corner;
            }
        }
        
        return maxCount > 0 ? maxCorner : null;
    }
    
    /**
     * 检查指定角的 N 路范围内是否有棋子
     * @param {Array} moves - 坐标序列
     * @param {string} cornerKey - 角标识
     * @param {number} cornerSize - 角大小（9/11/13）
     * @returns {boolean}
     */
    static hasStoneInCorner(moves, cornerKey, cornerSize = 9) {
        const ranges = {
            9: {
                tl: [0, 8, 0, 8],
                tr: [10, 18, 0, 8],
                bl: [0, 8, 10, 18],
                br: [10, 18, 10, 18]
            },
            11: {
                tl: [0, 10, 0, 10],
                tr: [8, 18, 0, 10],
                bl: [0, 10, 8, 18],
                br: [8, 18, 8, 18]
            },
            13: {
                tl: [0, 12, 0, 12],
                tr: [6, 18, 0, 12],
                bl: [0, 12, 6, 18],
                br: [6, 18, 6, 18]
            }
        };
        
        const range = ranges[cornerSize]?.[cornerKey];
        if (!range) return false;
        
        const [cmin, cmax, rmin, rmax] = range;
        
        for (const coord of moves) {
            if (!coord || coord === 'tt' || coord === 'pass' || coord.length !== 2) continue;
            try {
                const [col, row] = this.sgfToNums(coord);
                if (col >= cmin && col <= cmax && row >= rmin && row <= rmax) {
                    return true;
                }
            } catch (e) {
                continue;
            }
        }
        
        return false;
    }
    
    /**
     * 将定式坐标转换为右上角（视觉）的坐标
     * 参考 Python: convert_to_top_right
     * 
     * @param {Array} moves - 坐标序列（SGF 坐标字符串）
     * @param {string} sourceCorner - 源角位 ('tl', 'tr', 'bl', 'br')
     * @returns {Array} 转换后的坐标序列（右上角视角）
     */
    static convertToTopRight(moves, sourceCorner) {
        // 如果已经是右上角，无需转换
        if (sourceCorner === 'tr') {
            return moves;
        }
        
        const converted = [];
        
        for (const coord of moves) {
            if (!coord || coord === 'pass' || coord === 'tt') {
                converted.push(coord);
                continue;
            }
            
            try {
                const [col, row] = this.sgfToNums(coord);
                let newCol, newRow;
                
                if (sourceCorner === 'tl') {
                    // 左上角 -> 右上角：水平翻转
                    // lurd -> ruld
                    // (col, row) -> (18 - col, row)
                    newCol = 18 - col;
                    newRow = row;
                } else if (sourceCorner === 'bl') {
                    // 左下角 -> 右上角：旋转180°（水平和垂直都翻转）
                    // ldru -> ruld
                    // Python逻辑：先转局部坐标(col, 18-row)，再转SGF(18-x, y)
                    // 结果：(col, row) -> (18-col, 18-row)
                    newCol = 18 - col;
                    newRow = 18 - row;
                } else if (sourceCorner === 'br') {
                    // 右下角 -> 右上角：垂直翻转
                    // rdlu -> ruld
                    // (col, row) -> (col, 18 - row)
                    newCol = col;
                    newRow = 18 - row;
                } else {
                    converted.push(coord);
                    continue;
                }
                
                const newCoord = this.numsToSgf(newCol, newRow);
                converted.push(newCoord);
            } catch (e) {
                converted.push(coord);
            }
        }
        
        return converted;
    }
    
    /**
     * 将ruld方向的着法序列标准化到对角线上方（靠近上边缘）
     * 参考 Python: normalize_corner_sequence
     * 
     * 以过右上角顶点的对角线(c+r=18)为对称轴：
     * - c + r == 18: 着法在对角线上
     * - c + r < 18:  上半部分（靠近上边缘），已是标准方向
     * - c + r > 18:  下半部分（靠近左边缘），需要翻转
     * 
     * @param {Array} moves - ruld方向的SGF坐标列表
     * @returns {Object} {normalized: 标准化后的着法序列, flipped: 是否被翻转}
     */
    static normalizeCornerSequence(moves) {
        for (const sgf of moves) {
            if (!sgf || sgf === 'pass' || sgf === 'tt' || sgf.length !== 2) {
                continue;
            }
            
            const c = sgf.charCodeAt(0) - 97;  // 全局列 0-18
            const r = sgf.charCodeAt(1) - 97;  // 全局行 0-18
            
            const coordSum = c + r;
            
            if (coordSum === 18) {
                continue;  // 在对角线上，继续判断下一个着法
            }
            
            if (coordSum < 18) {
                // 上半部分（靠近上边缘），已是标准方向
                return { normalized: moves, flipped: false };
            } else {
                // 下半部分（靠近左边缘），需要翻转
                // 翻转操作: (c, r) -> (18-r, 18-c)
                const normalized = moves.map(coord => {
                    if (!coord || coord === 'pass' || coord === 'tt' || coord.length !== 2) {
                        return coord;
                    }
                    const cc = coord.charCodeAt(0) - 97;
                    const rr = coord.charCodeAt(1) - 97;
                    const newC = 18 - rr;
                    const newR = 18 - cc;
                    return this.numsToSgf(newC, newR);
                });
                return { normalized, flipped: true };
            }
        }
        
        // 所有着法都在对角线上或为空
        return { normalized: moves, flipped: false };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoordinateConverter;
}
