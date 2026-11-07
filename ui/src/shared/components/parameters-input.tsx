import {Select} from 'argo-ui/src/components/select/select';
import React from 'react';

import {Parameter} from '../models';
import {isParameterVisible, ParameterConditionContext} from '../parameter-conditions';
import {Tooltip} from './tooltip';

export function getValueFromParameter(p: Parameter) {
    if (p.value === undefined) {
        return p.default;
    } else {
        return p.value;
    }
}

export interface ParametersInputProps {
    parameters: Parameter[];
    onChange: (parameters: Parameter[]) => void;
    workflowParameters?: Parameter[];
    context?: ParameterConditionContext;
}

export function ParametersInput(props: ParametersInputProps) {
    const context: ParameterConditionContext = props.context || {
        workflowParameters: props.workflowParameters ?? props.parameters,
        parameters: props.parameters
    };

    function onParameterChange(parameter: Parameter, value: string) {
        const newParameters: Parameter[] = props.parameters.map(p => ({
            ...p,
            value: p.name === parameter.name ? value : getValueFromParameter(p)
        }));
        props.onChange(newParameters);
    }

    function displaySelectFieldForEnumValues(parameter: Parameter) {
        return (
            <Select
                key={parameter.name}
                value={getValueFromParameter(parameter)}
                options={parameter.enum.map(value => ({
                    value,
                    title: value
                }))}
                onChange={e => onParameterChange(parameter, e.value)}
            />
        );
    }

    function displayInputFieldForSingleValue(parameter: Parameter) {
        return <textarea className='argo-field' value={getValueFromParameter(parameter)} onChange={e => onParameterChange(parameter, e.target.value)} />;
    }

    return (
        <>
            {props.parameters.map((parameter, index) => {
                if (!isParameterVisible(parameter, context)) {
                    return null;
                }
                return (
                    <div key={parameter.name + '_' + index} style={{marginBottom: 14}}>
                        <label>{parameter.name}</label>
                        {parameter.description && (
                            <Tooltip content={parameter.description}>
                                <i className='fa fa-question-circle' style={{marginLeft: 4}} />
                            </Tooltip>
                        )}
                        {(parameter.enum && displaySelectFieldForEnumValues(parameter)) || displayInputFieldForSingleValue(parameter)}
                    </div>
                );
            })}
        </>
    );
}
