import {Parameter} from './models';
import {evaluateParameterCondition, getVisibleParameters, isParameterVisible, ParameterConditionContext} from './parameter-conditions';

describe('Parameter Conditions Evaluator', () => {
    describe('Backward compatibility / missing condition', () => {
        const context: ParameterConditionContext = {};

        it('returns true when "when" is undefined', () => {
            expect(evaluateParameterCondition(undefined, context)).toBe(true);
        });

        it('returns true when "when" is null', () => {
            expect(evaluateParameterCondition(null, context)).toBe(true);
        });

        it('returns true when "when" is empty string', () => {
            expect(evaluateParameterCondition('', context)).toBe(true);
            expect(evaluateParameterCondition('   ', context)).toBe(true);
        });
    });

    describe('Equality and Inequality', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'deployment-mode', value: 'advanced'},
                {name: 'environment', value: 'staging'}
            ]
        };

        it('evaluates string equality with double quotes', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} == "advanced"', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} == "standard"', context)).toBe(false);
        });

        it('evaluates string equality with single quotes', () => {
            expect(evaluateParameterCondition("{{workflow.parameters.deployment-mode}} == 'advanced'", context)).toBe(true);
            expect(evaluateParameterCondition("{{workflow.parameters.deployment-mode}} == 'standard'", context)).toBe(false);
        });

        it('evaluates string inequality', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} != "standard"', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} != "advanced"', context)).toBe(false);
        });

        it('evaluates bare identifier equality/inequality', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} == advanced', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.deployment-mode}} != standard', context)).toBe(true);
        });

        it('handles quoted template expressions', () => {
            expect(evaluateParameterCondition('"{{workflow.parameters.deployment-mode}}" == "advanced"', context)).toBe(true);
            expect(evaluateParameterCondition("'{{workflow.parameters.deployment-mode}}' == 'advanced'", context)).toBe(true);
        });
    });

    describe('Numeric comparisons', () => {
        const context: ParameterConditionContext = {
            parameters: [
                {name: 'cluster-size', value: '5'},
                {name: 'replicas', value: '10'},
                {name: 'min-nodes', default: '2'}
            ]
        };

        it('evaluates greater than (> and >=)', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} > 3', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} > 5', context)).toBe(false);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} >= 5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} >= 6', context)).toBe(false);
        });

        it('evaluates less than (< and <=)', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} < 10', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} < 5', context)).toBe(false);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} <= 5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} <= 4', context)).toBe(false);
        });

        it('evaluates numeric equality between string and number', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} == 5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} != 5', context)).toBe(false);
            expect(evaluateParameterCondition('{{inputs.parameters.cluster-size}} == 10', context)).toBe(false);
        });

        it('handles default value when value is not set', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.min-nodes}} == 2', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.min-nodes}} < 3', context)).toBe(true);
        });

        it('performs true numeric comparison instead of lexicographical', () => {
            // "10" is numerically greater than 5, but lexicographically "10" < "5"
            expect(evaluateParameterCondition('{{inputs.parameters.replicas}} > 5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.replicas}} < 5', context)).toBe(false);
        });
    });

    describe('Workflow and Input parameter references', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'wf-mode', value: 'prod'},
                {name: 'same-name', value: 'from-workflow'}
            ],
            parameters: [
                {name: 'input-mode', value: 'quick'},
                {name: 'same-name', value: 'from-input'}
            ]
        };

        it('resolves workflow parameters via workflow.parameters prefix', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.wf-mode}} == "prod"', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.wf-mode}} == "dev"', context)).toBe(false);
        });

        it('resolves entrypoint input parameters via inputs.parameters prefix', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.input-mode}} == "quick"', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.input-mode}} == "full"', context)).toBe(false);
        });

        it('distinguishes between workflow and input parameters with identical names', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.same-name}} == "from-workflow"', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.same-name}} == "from-input"', context)).toBe(true);
        });

        it('supports parameters alias and whitespace inside braces', () => {
            expect(evaluateParameterCondition('{{ workflow.parameters.wf-mode }} == "prod"', context)).toBe(true);
            expect(evaluateParameterCondition('{{   inputs.parameters.input-mode   }} == "quick"', context)).toBe(true);
        });

        it('supports Record<string, string> context as well as Parameter[]', () => {
            const mapContext: ParameterConditionContext = {
                workflowParameters: {'wf-mode': 'prod'},
                parameters: {'input-mode': 'quick'}
            };
            expect(evaluateParameterCondition('{{workflow.parameters.wf-mode}} == "prod"', mapContext)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.input-mode}} == "quick"', mapContext)).toBe(true);
        });
    });

    describe('Undefined references and empty values', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'empty-param', value: ''},
                {name: 'defined-param', value: 'hello'}
            ]
        };

        it('handles undefined parameter references gracefully', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.non-existent}} == ""', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.non-existent}} != ""', context)).toBe(false);
            expect(evaluateParameterCondition('{{workflow.parameters.non-existent}} == "val"', context)).toBe(false);
        });

        it('handles explicit empty strings', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.empty-param}} == ""', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.empty-param}} != ""', context)).toBe(false);
            expect(evaluateParameterCondition('{{workflow.parameters.defined-param}} != ""', context)).toBe(true);
        });
    });

    describe('Logical operators and grouping', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'env', value: 'production'},
                {name: 'tier', value: 'frontend'},
                {name: 'debug', value: 'false'}
            ]
        };

        it('evaluates logical AND (&&)', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.env}} == "production" && {{workflow.parameters.tier}} == "frontend"', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.env}} == "production" && {{workflow.parameters.tier}} == "backend"', context)).toBe(false);
        });

        it('evaluates logical OR (||)', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.env}} == "staging" || {{workflow.parameters.tier}} == "frontend"', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.env}} == "staging" || {{workflow.parameters.tier}} == "backend"', context)).toBe(false);
        });

        it('evaluates parentheses for precedence', () => {
            expect(
                evaluateParameterCondition(
                    '({{workflow.parameters.env}} == "staging" || {{workflow.parameters.env}} == "production") && {{workflow.parameters.tier}} == "frontend"',
                    context
                )
            ).toBe(true);
            expect(
                evaluateParameterCondition(
                    '({{workflow.parameters.env}} == "staging" || {{workflow.parameters.env}} == "dev") && {{workflow.parameters.tier}} == "frontend"',
                    context
                )
            ).toBe(false);
        });

        it('evaluates unary NOT (!)', () => {
            expect(evaluateParameterCondition('!({{workflow.parameters.env}} == "staging")', context)).toBe(true);
            expect(evaluateParameterCondition('!({{workflow.parameters.env}} == "production")', context)).toBe(false);
        });
    });

    describe('Malformed expressions', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [{name: 'mode', value: 'test'}]
        };

        it('returns false without throwing on unclosed quotes', () => {
            expect(() => evaluateParameterCondition('{{workflow.parameters.mode}} == "unclosed', context)).not.toThrow();
            expect(evaluateParameterCondition('{{workflow.parameters.mode}} == "unclosed', context)).toBe(false);
        });

        it('returns false without throwing on unclosed template braces', () => {
            expect(() => evaluateParameterCondition('{{workflow.parameters.mode == "test"', context)).not.toThrow();
            expect(evaluateParameterCondition('{{workflow.parameters.mode == "test"', context)).toBe(false);
        });

        it('returns false without throwing on syntax errors', () => {
            expect(() => evaluateParameterCondition('== == ==', context)).not.toThrow();
            expect(evaluateParameterCondition('== == ==', context)).toBe(false);
        });
    });

    describe('Numeric-looking strings and units', () => {
        const context: ParameterConditionContext = {
            parameters: [
                {name: 'mem', value: '500Mi'},
                {name: 'cpu', value: '100m'},
                {name: 'duration', value: '24h'},
                {name: 'instance-type', value: '2xlarge'},
                {name: 'version', value: '2.0.0'},
                {name: 'ip', value: '192.168.1.1'},
                {name: 'count', value: '10'},
                {name: 'ratio', value: '10.5'},
                {name: 'offset', value: '-5'},
                {name: 'pi-neg', value: '-3.14'}
            ]
        };

        it('evaluates equality for Kubernetes memory and CPU units', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.mem}} == 500Mi', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.mem}} != 1Gi', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cpu}} == 100m', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.cpu}} != 200m', context)).toBe(true);
        });

        it('evaluates duration and SKU strings starting with numbers', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.duration}} == 24h', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.duration}} == 12h', context)).toBe(false);
            expect(evaluateParameterCondition('{{inputs.parameters.instance-type}} == 2xlarge', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.instance-type}} == 4xlarge', context)).toBe(false);
        });

        it('evaluates multi-dot version strings and IP addresses without truncation', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.version}} == 2.0.0', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.version}} == 2.0.1', context)).toBe(false);
            expect(evaluateParameterCondition('{{inputs.parameters.ip}} == 192.168.1.1', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.ip}} != 192.168.1.2', context)).toBe(true);
        });

        it('preserves numeric parsing and comparison for integers, floats, and negative numbers', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.count}} == 10', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.count}} > 5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.ratio}} == 10.5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.ratio}} > 10.4', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.ratio}} < 10.6', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.offset}} == -5', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.offset}} < 0', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.offset}} > -10', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.pi-neg}} == -3.14', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.pi-neg}} < -3.0', context)).toBe(true);
        });

        it('supports logical expressions combining numeric and string-literal conditions', () => {
            expect(evaluateParameterCondition('{{inputs.parameters.mem}} == 500Mi && {{inputs.parameters.count}} >= 10', context)).toBe(true);
            expect(evaluateParameterCondition('{{inputs.parameters.mem}} == 1Gi || {{inputs.parameters.version}} == 2.0.0', context)).toBe(true);
        });
    });

    describe('Quoted strings and Unterminated string rejection', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'mode', value: 'advanced'},
                {name: 'spaced', value: 'hello world'},
                {name: 'single-quoted', value: "it's working"},
                {name: 'double-quoted', value: 'said "hello"'}
            ]
        };

        it('rejects unterminated double-quoted strings and returns false safely', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.mode}} == "advanced', context)).toBe(false);
            expect(evaluateParameterCondition('"unterminated == "test"', context)).toBe(false);
        });

        it('rejects unterminated single-quoted strings and returns false safely', () => {
            expect(evaluateParameterCondition("{{workflow.parameters.mode}} == 'advanced", context)).toBe(false);
            expect(evaluateParameterCondition("'unterminated == 'test'", context)).toBe(false);
        });

        it('rejects unterminated strings even when content matches parameter value', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.mode}} == "advanced', context)).toBe(false);
            expect(evaluateParameterCondition("{{workflow.parameters.mode}} == 'advanced", context)).toBe(false);
        });

        it('handles valid strings containing spaces', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.spaced}} == "hello world"', context)).toBe(true);
            expect(evaluateParameterCondition("{{workflow.parameters.spaced}} == 'hello world'", context)).toBe(true);
        });

        it('handles escaped double quotes within double-quoted strings', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.double-quoted}} == "said \\"hello\\""', context)).toBe(true);
        });

        it('handles escaped single quotes within single-quoted strings', () => {
            expect(evaluateParameterCondition("{{workflow.parameters.single-quoted}} == 'it\\'s working'", context)).toBe(true);
        });
    });

    describe('Boolean and Numeric comparisons', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [
                {name: 'bool-true', value: 'true'},
                {name: 'bool-false', value: 'false'},
                {name: 'num-one', value: '1'},
                {name: 'num-zero', value: '0'}
            ]
        };

        it('does not coerce booleans to numbers: true != 1 and false != 0', () => {
            expect(evaluateParameterCondition('true == 1', context)).toBe(false);
            expect(evaluateParameterCondition('true != 1', context)).toBe(true);
            expect(evaluateParameterCondition('false == 0', context)).toBe(false);
            expect(evaluateParameterCondition('false != 0', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.bool-true}} == 1', context)).toBe(false);
            expect(evaluateParameterCondition('{{workflow.parameters.bool-false}} == 0', context)).toBe(false);
        });

        it('evaluates boolean equality with boolean literals and string booleans', () => {
            expect(evaluateParameterCondition('true == true', context)).toBe(true);
            expect(evaluateParameterCondition('false == false', context)).toBe(true);
            expect(evaluateParameterCondition('true != false', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.bool-true}} == true', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.bool-false}} == false', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.bool-true}} != false', context)).toBe(true);
        });

        it('evaluates numeric comparisons between numeric strings and numbers', () => {
            expect(evaluateParameterCondition('{{workflow.parameters.num-one}} == 1', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.num-zero}} == 0', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.num-one}} > 0', context)).toBe(true);
            expect(evaluateParameterCondition('{{workflow.parameters.num-zero}} < 1', context)).toBe(true);
        });
    });

    describe('Helper functions: isParameterVisible and getVisibleParameters', () => {
        const context: ParameterConditionContext = {
            workflowParameters: [{name: 'mode', value: 'advanced'}]
        };

        const params: Parameter[] = [
            {name: 'p1', value: 'v1'}, // no condition -> visible
            {name: 'p2', value: 'v2', when: '{{workflow.parameters.mode}} == "advanced"'}, // true -> visible
            {name: 'p3', value: 'v3', when: '{{workflow.parameters.mode}} == "simple"'}, // false -> hidden
            {name: 'p4', value: 'v4', when: '{{workflow.parameters.mode}} != "advanced"'} // false -> hidden
        ];

        it('isParameterVisible checks single parameter', () => {
            expect(isParameterVisible(params[0], context)).toBe(true);
            expect(isParameterVisible(params[1], context)).toBe(true);
            expect(isParameterVisible(params[2], context)).toBe(false);
            expect(isParameterVisible(params[3], context)).toBe(false);
        });

        it('getVisibleParameters filters parameter array without mutating', () => {
            const visible = getVisibleParameters(params, context);
            expect(visible.map(p => p.name)).toEqual(['p1', 'p2']);
            // Original array unchanged
            expect(params.length).toBe(4);
        });
    });
});
