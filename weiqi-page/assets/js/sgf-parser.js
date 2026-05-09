/**
 * SGF 解析器
 * 完整支持嵌套变化分支
 * 参考 Python 版本：weiqi-joseki/src/extraction/sgf_parser.py
 */

class SGFParser {
    /**
     * 解析 SGF 内容
     * @param {string} sgfContent - SGF 字符串
     * @returns {Object} 解析结果
     */
    parse(sgfContent) {
        this.errors = [];
        
        const content = sgfContent.trim();
        if (!content) {
            this.errors.push("SGF内容为空");
            return this._createEmptyResult();
        }
        
        try {
            const rootNode = this._parseTree(content);
            const tree = this._nodeToDict(rootNode);
            const stats = this._calcStats(tree);
            const gameInfo = this._extractGameInfo(tree);
            
            return {
                game_info: gameInfo,
                tree: tree,
                stats: stats,
                errors: this.errors
            };
        } catch (e) {
            this.errors.push(`解析错误: ${e.message}`);
            return this._createEmptyResult();
        }
    }
    
    _createEmptyResult() {
        const emptyTree = {
            properties: {},
            is_root: true,
            move_number: 0,
            color: null,
            coord: null,
            children: []
        };
        return {
            game_info: this._extractGameInfo(emptyTree),
            tree: emptyTree,
            stats: { total_nodes: 1, move_nodes: 0, max_depth: 0, branch_count: 0 },
            errors: this.errors
        };
    }
    
    _parseTree(content) {
        const parentStack = [];
        let seqCurrent = null;
        let root = null;
        let i = 0;
        const n = content.length;
        let parenCount = 0;
        let pendingBranchProps = {};
        
        while (i < n) {
            const char = content[i];
            
            if (char === '(') {
                // 开始新序列
                if (seqCurrent !== null) {
                    parentStack.push(seqCurrent);
                } else if (parentStack.length > 0) {
                    parentStack.push(parentStack[parentStack.length - 1]);
                } else if (root !== null) {
                    parentStack.push(root);
                }
                
                parenCount++;
                seqCurrent = null;
                i++;
                
                // 预读并缓存 '(' 后的属性
                pendingBranchProps = {};
                while (i < n) {
                    const c = content[i];
                    if (c === '(' || c === ')' || c === ';') break;
                    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
                        i++;
                        continue;
                    }
                    if (c >= 'A' && c <= 'Z') {
                        let propName = '';
                        while (i < n && content[i] >= 'A' && content[i] <= 'Z') {
                            propName += content[i];
                            i++;
                        }
                        const values = [];
                        while (i < n && content[i] === '[') {
                            const result = this._parsePropertyValue(content, i + 1);
                            values.push(result.value);
                            i = result.newPos;
                        }
                        if (values.length > 0) {
                            pendingBranchProps[propName] = values.length > 1 ? values : values[0];
                        }
                    } else {
                        this.errors.push(`位置 ${i}: 分支注释中意外字符 '${c}'，跳过`);
                        i++;
                    }
                }
            } else if (char === ')') {
                // 结束当前序列
                if (parenCount > 0) {
                    if (parentStack.length > 0) {
                        const parent = parentStack.pop();
                        seqCurrent = parent;
                    } else {
                        seqCurrent = null;
                    }
                    parenCount--;
                } else {
                    this.errors.push(`位置 ${i}: 多余的右括号`);
                }
                i++;
            } else if (char === ';') {
                // 创建新节点
                const newNode = {
                    properties: {},
                    is_root: false,
                    move_number: 0,
                    color: null,
                    coord: null,
                    parent: null,
                    children: []
                };
                
                // 确定父节点
                if (seqCurrent !== null) {
                    seqCurrent.children.push(newNode);
                    newNode.parent = seqCurrent;
                    newNode.move_number = seqCurrent.is_root ? 1 : seqCurrent.move_number + 1;
                } else if (parentStack.length > 0) {
                    const parent = parentStack[parentStack.length - 1];
                    parent.children.push(newNode);
                    newNode.parent = parent;
                    newNode.move_number = parent.is_root ? 1 : parent.move_number + 1;
                } else if (root === null) {
                    root = newNode;
                    newNode.is_root = true;
                    newNode.move_number = 0;
                } else {
                    // 另一个顶级节点
                    if (root.is_root && root.children.length === 0 && Object.keys(root.properties).length === 0) {
                        root.properties = {};
                        newNode.parent = root;
                        newNode.move_number = 1;
                        root.children.push(newNode);
                    } else if (root.is_root) {
                        const wrapper = {
                            properties: {},
                            is_root: true,
                            move_number: 0,
                            color: null,
                            coord: null,
                            parent: null,
                            children: []
                        };
                        root.parent = wrapper;
                        root.move_number = 1;
                        wrapper.children.push(root);
                        root = wrapper;
                        
                        newNode.parent = root;
                        newNode.move_number = 1;
                        root.children.push(newNode);
                    } else {
                        newNode.parent = root;
                        newNode.move_number = 1;
                        root.children.push(newNode);
                    }
                }
                
                // 解析属性
                const propsResult = this._parseProperties(content, i + 1);
                const props = propsResult.props;
                i = propsResult.newPos;
                
                // 合并缓存的分支属性
                if (Object.keys(pendingBranchProps).length > 0) {
                    const mergedProps = { ...pendingBranchProps, ...props };
                    props = mergedProps;
                    pendingBranchProps = {};
                }
                
                newNode.properties = props;
                this._extractMoveInfo(newNode);
                
                seqCurrent = newNode;
            } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
                i++;
            } else {
                this.errors.push(`位置 ${i}: 意外字符 '${char}'，跳过`);
                i++;
            }
        }
        
        if (parenCount > 0) {
            this.errors.push("警告: 括号未完全闭合");
        }
        
        return root || {
            properties: {},
            is_root: true,
            move_number: 0,
            color: null,
            coord: null,
            parent: null,
            children: []
        };
    }
    
    _parseProperties(content, start) {
        const props = {};
        let i = start;
        const n = content.length;
        
        while (i < n) {
            const char = content[i];
            
            if (char === '(' || char === ')' || char === ';') break;
            if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
                i++;
                continue;
            }
            
            if (char >= 'A' && char <= 'Z') {
                let propName = '';
                while (i < n && content[i] >= 'A' && content[i] <= 'Z') {
                    propName += content[i];
                    i++;
                }
                
                const values = [];
                while (i < n && content[i] === '[') {
                    const result = this._parsePropertyValue(content, i + 1);
                    values.push(result.value);
                    i = result.newPos;
                }
                
                if (values.length > 0) {
                    props[propName] = values.length > 1 ? values : values[0];
                } else {
                    props[propName] = '';
                }
            } else {
                this.errors.push(`位置 ${i}: 属性名应为大写字母，跳过 '${char}'`);
                i++;
            }
        }
        
        return { props, newPos: i };
    }
    
    _parsePropertyValue(content, start) {
        const value = [];
        let i = start;
        const n = content.length;
        
        while (i < n) {
            const char = content[i];
            
            if (char === '\\' && i + 1 < n) {
                const nextChar = content[i + 1];
                if (nextChar === ']') {
                    value.push(']');
                    i += 2;
                } else if (nextChar === '\\') {
                    value.push('\\');
                    i += 2;
                } else if (nextChar === 'n') {
                    value.push('\n');
                    i += 2;
                } else if (nextChar === 'r') {
                    value.push('\r');
                    i += 2;
                } else if (nextChar === 't') {
                    value.push('\t');
                    i += 2;
                } else {
                    value.push(nextChar);
                    i += 2;
                }
            } else if (char === ']') {
                i++;
                return { value: value.join(''), newPos: i };
            } else {
                value.push(char);
                i++;
            }
        }
        
        // 未正常闭合
        this.errors.push("属性值未闭合");
        return { value: value.join(''), newPos: i };
    }
    
    _extractMoveInfo(node) {
        if ('B' in node.properties) {
            node.color = 'B';
            node.coord = this._normalizeCoord(node.properties['B']);
        } else if ('W' in node.properties) {
            node.color = 'W';
            node.coord = this._normalizeCoord(node.properties['W']);
        }
    }
    
    _normalizeCoord(val) {
        if (Array.isArray(val) && val.length > 0) {
            return val[0] || null;
        }
        return val || null;
    }
    
    _nodeToDict(node) {
        return {
            properties: node.properties,
            is_root: node.is_root,
            move_number: node.move_number,
            color: node.color,
            coord: node.coord,
            children: node.children.map(c => this._nodeToDict(c))
        };
    }
    
    _calcStats(tree) {
        let totalNodes = 0;
        let moveNodes = 0;
        let maxDepth = 0;
        let branchCount = 0;
        
        const traverse = (node) => {
            totalNodes++;
            if (!node.is_root) {
                moveNodes++;
            }
            maxDepth = Math.max(maxDepth, node.move_number);
            const children = node.children || [];
            if (children.length > 1) {
                branchCount += children.length - 1;
            }
            for (const child of children) {
                traverse(child);
            }
        };
        
        traverse(tree);
        
        return {
            total_nodes: totalNodes,
            move_nodes: moveNodes,
            max_depth: maxDepth,
            branch_count: branchCount
        };
    }
    
    _extractGameInfo(tree) {
        const props = tree.properties || {};
        
        const getProp = (key, defaultValue = '') => {
            const val = props[key] || defaultValue;
            if (Array.isArray(val) && val.length > 0) {
                return String(val[0]);
            }
            return val ? String(val) : defaultValue;
        };
        
        // 棋盘大小
        let boardSize = 19;
        try {
            boardSize = parseInt(getProp('SZ', '19'));
        } catch (e) {}
        
        // 让子数
        let handicap = 0;
        try {
            handicap = parseInt(getProp('HA', '0'));
        } catch (e) {}
        
        // 让子位置
        const handicapStones = [];
        const abProp = props['AB'] || [];
        const abList = Array.isArray(abProp) ? abProp : [abProp];
        for (const coord of abList) {
            if (coord && coord.length >= 2) {
                const x = coord.charCodeAt(0) - 97;
                const y = coord.charCodeAt(1) - 97;
                if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
                    handicapStones.push({ x, y });
                }
            }
        }
        
        return {
            board_size: boardSize,
            black: getProp('PB', '黑棋'),
            white: getProp('PW', '白棋'),
            black_rank: getProp('BR'),
            white_rank: getProp('WR'),
            game_name: getProp('GN', '围棋棋谱'),
            date: getProp('DT'),
            result: getProp('RE'),
            komi: getProp('KM', '375'),
            handicap: handicap,
            handicap_stones: handicapStones
        };
    }
    
    /**
     * 提取主分支着法
     * @param {Object} tree - SGF 树
     * @param {number} firstN - 只取前N手
     * @returns {Array} [(color, coord), ...]
     */
    extractMainBranch(tree, firstN = 80) {
        const moves = [];
        let node = tree;
        
        while (node.children && node.children.length > 0) {
            node = node.children[0];
            const coord = node.coord || 'tt';
            moves.push([node.color, coord]);
            if (moves.length >= firstN) break;
        }
        
        return moves;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SGFParser;
}
