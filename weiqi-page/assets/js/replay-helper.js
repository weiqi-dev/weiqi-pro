/**
 * Replay 数据生成辅助模块
 * 封装 SGF 解析和 replay 数据构造逻辑
 */

class ReplayHelper {
    /**
     * 从 SGF 内容生成 replay 数据
     * 参考 Python: weiqi-sgf/scripts/replay.py
     * 
     * @param {string} sgfContent - SGF 内容
     * @param {Object} gameInfo - 游戏信息（可选）
     * @param {number} defaultMove - 默认跳转手数（-1 表示最后一手）
     * @returns {Object} replay 数据
     */
    static generateReplayData(sgfContent, gameInfo = {}, defaultMove = -1) {
        // 使用 SGFParser 解析 SGF
        const parser = new SGFParser();
        const parsed = parser.parse(sgfContent);
        
        if (!parsed || !parsed.tree) {
            throw new Error('SGF 解析失败');
        }
        
        // 简化树结构
        const cleanTree = this.simplifyTree(parsed.tree);
        
        // 计算最大手数
        const maxMoves = this.countMaxMoves(cleanTree);
        
        // 从 SGF 属性中提取信息
        const props = parsed.tree.properties || {};
        const getProp = (key, defaultVal = '') => {
            const val = props[key] || defaultVal;
            if (Array.isArray(val) && val.length > 0) {
                return String(val[0]);
            }
            return val ? String(val) : defaultVal;
        };
        
        // 构造 replay 数据格式（参考 replay.py）
        const replayData = {
            game_name: gameInfo.game_name || `${gameInfo.black || '黑棋'} vs ${gameInfo.white || '白棋'}`,
            black: gameInfo.black || getProp('PB', '黑棋'),
            white: gameInfo.white || getProp('PW', '白棋'),
            black_rank: gameInfo.black_rank || getProp('BR', ''),
            white_rank: gameInfo.white_rank || getProp('WR', ''),
            board_size: parseInt(gameInfo.board_size || getProp('SZ', '19')),
            handicap: parseInt(gameInfo.handicap || getProp('HA', '0')),
            handicap_stones: gameInfo.handicap_stones || [],
            result: gameInfo.result || getProp('RE', ''),
            tree: cleanTree,
            download_filename: gameInfo.download_filename || 'game.sgf',
            default_move: defaultMove === -1 ? maxMoves : defaultMove,
            max_moves: maxMoves
        };
        
        return replayData;
    }
    
    /**
     * 简化树结构，只保留 color, coord, children, properties(C/N)
     * 参考 Python: replay.py 的 simplify_tree 函数
     * 
     * @param {Object} node - 树节点
     * @returns {Object} 简化后的树节点
     */
    static simplifyTree(node) {
        if (!node) return null;
        
        const simplified = {
            'color': node.color || null,
            'coord': node.coord || null
        };
        
        // 保留 C（注释）和 N（标签）属性
        if (node.properties) {
            const props = node.properties;
            const keepProps = {};
            if (props.C) keepProps.C = props.C;
            if (props.N) keepProps.N = props.N;
            if (Object.keys(keepProps).length > 0) {
                simplified.properties = keepProps;
            }
        }
        
        // 递归处理子节点
        if (node.children && node.children.length > 0) {
            simplified.children = node.children
                .map(child => this.simplifyTree(child))
                .filter(child => child !== null);
        }
        
        return simplified;
    }
    
    /**
     * 计算棋谱最大手数
     * 
     * @param {Object} node - 树节点
     * @returns {number} 最大手数
     */
    static countMaxMoves(node) {
        if (!node) return 0;
        let count = node.color ? 1 : 0;
        if (node.children && node.children.length > 0) {
            count += this.countMaxMoves(node.children[0]);
        }
        return count;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReplayHelper;
}
