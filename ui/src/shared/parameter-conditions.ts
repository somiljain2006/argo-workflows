import {Parameter} from './models';

export interface ParameterConditionContext {
    workflowParameters?: Parameter[] | Record<string, string | undefined>;
    parameters?: Parameter[] | Record<string, string | undefined>;
    inputsParameters?: Parameter[] | Record<string, string | undefined>;
}

type TokenType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'VAR' | 'IDENT' | 'OPERATOR' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
    type: TokenType;
    value: string;
    scope?: 'workflow' | 'inputs';
    paramName?: string;
}

type EvalValue = string | number | boolean | undefined;

function getParamValueFromCollection(collection: Parameter[] | Record<string, string | undefined> | undefined, name: string): string | undefined {
    if (!collection) {
        return undefined;
    }
    if (Array.isArray(collection)) {
        const found = collection.find(p => p.name === name);
        if (!found) {
            return undefined;
        }
        return found.value !== undefined ? found.value : found.default;
    }
    return collection[name];
}

function resolveVariable(scope: 'workflow' | 'inputs' | undefined, paramName: string, context: ParameterConditionContext): string | undefined {
    if (scope === 'workflow') {
        return getParamValueFromCollection(context.workflowParameters, paramName);
    }
    if (scope === 'inputs') {
        return getParamValueFromCollection(context.parameters, paramName) ?? getParamValueFromCollection(context.inputsParameters, paramName);
    }
    // If scope is not specified, check inputs then workflow
    return (
        getParamValueFromCollection(context.parameters, paramName) ??
        getParamValueFromCollection(context.inputsParameters, paramName) ??
        getParamValueFromCollection(context.workflowParameters, paramName)
    );
}

function interpolateVariables(raw: string, context: ParameterConditionContext): string {
    return raw.replace(/\{\{\s*(?:(workflow|inputs)\.parameters\.|parameters\.)?([-a-zA-Z0-9_]+)\s*\}\}/g, (_, scope, name) => {
        const val = resolveVariable(scope as 'workflow' | 'inputs' | undefined, name, context);
        return val !== undefined ? val : '';
    });
}

class Tokenizer {
    private pos = 0;
    constructor(
        private input: string,
        private context: ParameterConditionContext
    ) {}

    nextToken(): Token {
        this.skipWhitespace();
        if (this.pos >= this.input.length) {
            return {type: 'EOF', value: ''};
        }

        const ch = this.input[this.pos];

        if (ch === '(') {
            this.pos++;
            return {type: 'LPAREN', value: '('};
        }
        if (ch === ')') {
            this.pos++;
            return {type: 'RPAREN', value: ')'};
        }

        // Two-character operators
        const twoChar = this.input.slice(this.pos, this.pos + 2);
        if (['==', '!=', '<=', '>=', '&&', '||'].includes(twoChar)) {
            this.pos += 2;
            return {type: 'OPERATOR', value: twoChar};
        }

        // One-character operators
        if (['<', '>', '!'].includes(ch)) {
            this.pos++;
            return {type: 'OPERATOR', value: ch};
        }

        // Template variables: {{ ... }}
        if (twoChar === '{{') {
            const endIdx = this.input.indexOf('}}', this.pos + 2);
            if (endIdx === -1) {
                throw new Error(`Unterminated template variable at position ${this.pos}`);
            }
            const inner = this.input.slice(this.pos + 2, endIdx).trim();
            this.pos = endIdx + 2;

            const varMatch = inner.match(/^(?:(workflow|inputs)\.parameters\.|parameters\.)?([-a-zA-Z0-9_]+)$/);
            if (varMatch) {
                return {
                    type: 'VAR',
                    value: inner,
                    scope: varMatch[1] as 'workflow' | 'inputs' | undefined,
                    paramName: varMatch[2]
                };
            }
            return {type: 'VAR', value: inner, paramName: inner};
        }

        // Quoted strings: "..." or '...'
        if (ch === '"' || ch === "'") {
            const quote = ch;
            this.pos++;
            let str = '';
            let closed = false;
            while (this.pos < this.input.length) {
                const c = this.input[this.pos];
                if (c === '\\') {
                    this.pos++;
                    if (this.pos < this.input.length) {
                        const escaped = this.input[this.pos];
                        if (escaped === 'n') str += '\n';
                        else if (escaped === 't') str += '\t';
                        else str += escaped;
                        this.pos++;
                    }
                } else if (c === quote) {
                    this.pos++;
                    closed = true;
                    break;
                } else {
                    str += c;
                    this.pos++;
                }
            }
            if (!closed) {
                throw new Error(`Unterminated string literal starting at position ${this.pos - str.length - 1}`);
            }
            // Support interpolation within quoted strings
            const interpolated = interpolateVariables(str, this.context);
            return {type: 'STRING', value: interpolated};
        }

        // Identifiers, numbers, booleans, or bare words
        let word = '';
        while (this.pos < this.input.length && !this.isDelimiter(this.input[this.pos])) {
            word += this.input[this.pos];
            this.pos++;
        }

        // Pure numeric values (e.g. 10, 10.5, -5, -3.14, 0, .5)
        // Values like 500Mi, 100m, 24h, 2xlarge, 2.0.0, 192.168.1.1 are treated as string identifiers
        if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(word)) {
            return {type: 'NUMBER', value: word};
        }

        if (word.toLowerCase() === 'true' || word.toLowerCase() === 'false') {
            return {type: 'BOOLEAN', value: word.toLowerCase()};
        }

        // Check if bare identifier is a variable reference (e.g. workflow.parameters.foo)
        const bareVarMatch = word.match(/^(workflow|inputs)\.parameters\.([-a-zA-Z0-9_]+)$/);
        if (bareVarMatch) {
            return {
                type: 'VAR',
                value: word,
                scope: bareVarMatch[1] as 'workflow' | 'inputs',
                paramName: bareVarMatch[2]
            };
        }

        return {type: 'IDENT', value: word};
    }

    private skipWhitespace() {
        while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
            this.pos++;
        }
    }

    private isDelimiter(ch: string): boolean {
        return /\s/.test(ch) || ['(', ')', '=', '!', '<', '>', '&', '|', '"', "'"].includes(ch);
    }
}

class Parser {
    private currentToken: Token;

    constructor(
        private tokenizer: Tokenizer,
        private context: ParameterConditionContext
    ) {
        this.currentToken = this.tokenizer.nextToken();
    }

    private eat(expectedType: TokenType): Token {
        const token = this.currentToken;
        if (token.type !== expectedType) {
            throw new Error(`Expected token ${expectedType} but got ${token.type} (${token.value})`);
        }
        this.currentToken = this.tokenizer.nextToken();
        return token;
    }

    parse(): EvalValue {
        const result = this.parseOr();
        if (this.currentToken.type !== 'EOF') {
            throw new Error(`Unexpected token after expression: ${this.currentToken.value}`);
        }
        return result;
    }

    private parseOr(): EvalValue {
        let left = this.parseAnd();
        while (this.currentToken.type === 'OPERATOR' && this.currentToken.value === '||') {
            this.eat('OPERATOR');
            const right = this.parseAnd();
            left = this.isTruthy(left) || this.isTruthy(right);
        }
        return left;
    }

    private parseAnd(): EvalValue {
        let left = this.parseComparison();
        while (this.currentToken.type === 'OPERATOR' && this.currentToken.value === '&&') {
            this.eat('OPERATOR');
            const right = this.parseComparison();
            left = this.isTruthy(left) && this.isTruthy(right);
        }
        return left;
    }

    private parseComparison(): EvalValue {
        let left = this.parseUnary();
        const compOps = ['==', '!=', '<', '<=', '>', '>='];
        while (this.currentToken.type === 'OPERATOR' && compOps.includes(this.currentToken.value)) {
            const op = this.currentToken.value;
            this.eat('OPERATOR');
            const right = this.parseUnary();
            left = this.evaluateComparison(left, op, right);
        }
        return left;
    }

    private parseUnary(): EvalValue {
        if (this.currentToken.type === 'OPERATOR' && this.currentToken.value === '!') {
            this.eat('OPERATOR');
            const operand = this.parseUnary();
            return !this.isTruthy(operand);
        }
        return this.parsePrimary();
    }

    private parsePrimary(): EvalValue {
        const token = this.currentToken;

        if (token.type === 'LPAREN') {
            this.eat('LPAREN');
            const val = this.parseOr();
            this.eat('RPAREN');
            return val;
        }

        if (token.type === 'NUMBER') {
            this.eat('NUMBER');
            return parseFloat(token.value);
        }

        if (token.type === 'STRING') {
            this.eat('STRING');
            return token.value;
        }

        if (token.type === 'BOOLEAN') {
            this.eat('BOOLEAN');
            return token.value === 'true';
        }

        if (token.type === 'VAR') {
            this.eat('VAR');
            const val = resolveVariable(token.scope, token.paramName || token.value, this.context);
            return val !== undefined ? val : '';
        }

        if (token.type === 'IDENT') {
            this.eat('IDENT');
            // Bare word treated as string literal (following Argo Workflows conventions)
            return token.value;
        }

        throw new Error(`Unexpected token in expression: ${token.type} (${token.value})`);
    }

    private evaluateComparison(left: EvalValue, op: string, right: EvalValue): boolean {
        // Handle numeric comparisons
        const isNumericComparison = ['<', '<=', '>', '>='].includes(op);
        const canLeftBeNum = left !== undefined && left !== '' && typeof left !== 'boolean' && !isNaN(Number(left));
        const canRightBeNum = right !== undefined && right !== '' && typeof right !== 'boolean' && !isNaN(Number(right));

        if (canLeftBeNum && canRightBeNum) {
            const numLeft = Number(left);
            const numRight = Number(right);
            switch (op) {
                case '==':
                    return numLeft === numRight;
                case '!=':
                    return numLeft !== numRight;
                case '<':
                    return numLeft < numRight;
                case '<=':
                    return numLeft <= numRight;
                case '>':
                    return numLeft > numRight;
                case '>=':
                    return numLeft >= numRight;
            }
        }

        if (isNumericComparison) {
            // Lexicographical fallback for strings
            const strLeft = left === undefined ? '' : String(left);
            const strRight = right === undefined ? '' : String(right);
            switch (op) {
                case '<':
                    return strLeft < strRight;
                case '<=':
                    return strLeft <= strRight;
                case '>':
                    return strLeft > strRight;
                case '>=':
                    return strLeft >= strRight;
            }
        }

        // Handle boolean equality comparisons
        const isLeftBool = typeof left === 'boolean';
        const isRightBool = typeof right === 'boolean';
        if (isLeftBool || isRightBool) {
            const isLeftBoolLike = typeof left === 'boolean' || (typeof left === 'string' && (left.toLowerCase() === 'true' || left.toLowerCase() === 'false'));
            const isRightBoolLike = typeof right === 'boolean' || (typeof right === 'string' && (right.toLowerCase() === 'true' || right.toLowerCase() === 'false'));

            if (!isLeftBoolLike || !isRightBoolLike) {
                return op === '==' ? false : true;
            }

            const boolLeft = typeof left === 'boolean' ? left : String(left).toLowerCase() === 'true';
            const boolRight = typeof right === 'boolean' ? right : String(right).toLowerCase() === 'true';
            return op === '==' ? boolLeft === boolRight : boolLeft !== boolRight;
        }

        // Standard string equality
        const strLeft = left === undefined ? '' : String(left);
        const strRight = right === undefined ? '' : String(right);
        return op === '==' ? strLeft === strRight : strLeft !== strRight;
    }

    private isTruthy(val: EvalValue): boolean {
        if (val === undefined || val === null) {
            return false;
        }
        if (typeof val === 'boolean') {
            return val;
        }
        if (typeof val === 'number') {
            return val !== 0;
        }
        const str = String(val).trim().toLowerCase();
        return str !== '' && str !== 'false' && str !== '0';
    }
}

/**
 * Evaluates a parameter's "when" condition expression against the provided context.
 * Returns true if the condition evaluates to true, or if no condition is defined.
 * If expression parsing or evaluation fails, returns false safely without throwing.
 */
export function evaluateParameterCondition(when: string | undefined | null, context: ParameterConditionContext): boolean {
    if (!when || when.trim() === '') {
        return true;
    }

    try {
        const tokenizer = new Tokenizer(when.trim(), context);
        const parser = new Parser(tokenizer, context);
        const result = parser.parse();

        if (typeof result === 'boolean') {
            return result;
        }
        if (typeof result === 'number') {
            return result !== 0;
        }
        if (typeof result === 'string') {
            const s = result.trim().toLowerCase();
            return s !== '' && s !== 'false' && s !== '0';
        }
        return false;
    } catch (err) {
        // Silently prevent crashing the UI while logging a debug warning
        // eslint-disable-next-line no-console
        console.warn(`Failed to evaluate parameter condition "${when}":`, err);
        return false;
    }
}

/**
 * Checks whether a parameter should be visible according to its "when" expression.
 */
export function isParameterVisible(parameter: Parameter, context: ParameterConditionContext): boolean {
    return evaluateParameterCondition(parameter.when, context);
}

/**
 * Returns only the parameters whose "when" conditions evaluate to true.
 */
export function getVisibleParameters(parameters: Parameter[], context: ParameterConditionContext): Parameter[] {
    return parameters.filter(param => isParameterVisible(param, context));
}
