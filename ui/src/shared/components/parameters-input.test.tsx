import {fireEvent, render, screen} from '@testing-library/react';
import React, {useState} from 'react';

import {Parameter} from '../models';
import {ParametersInput} from './parameters-input';

describe('ParametersInput', () => {
    it('renders parameters without conditions', () => {
        const parameters: Parameter[] = [
            {name: 'param1', value: 'value1'},
            {name: 'param2', default: 'default2'}
        ];
        const onChange = jest.fn();

        render(<ParametersInput parameters={parameters} onChange={onChange} />);

        expect(screen.getByText('param1')).toBeInTheDocument();
        expect(screen.getByText('param2')).toBeInTheDocument();
    });

    it('renders parameters with true conditions and hides parameters with false conditions', () => {
        const parameters: Parameter[] = [
            {name: 'mode', value: 'standard'},
            {name: 'cluster-size', value: '3', when: '{{inputs.parameters.mode}} == "advanced"'},
            {name: 'region', value: 'us-east-1', when: '{{inputs.parameters.mode}} == "standard"'}
        ];
        const onChange = jest.fn();

        render(<ParametersInput parameters={parameters} onChange={onChange} />);

        expect(screen.getByText('mode')).toBeInTheDocument();
        expect(screen.getByText('region')).toBeInTheDocument();
        expect(screen.queryByText('cluster-size')).not.toBeInTheDocument();
    });

    it('evaluates conditions against workflowParameters context', () => {
        const workflowParameters: Parameter[] = [{name: 'wf-mode', value: 'advanced'}];
        const parameters: Parameter[] = [
            {name: 'adv-setting', value: 'high', when: '{{workflow.parameters.wf-mode}} == "advanced"'},
            {name: 'std-setting', value: 'low', when: '{{workflow.parameters.wf-mode}} == "standard"'}
        ];
        const onChange = jest.fn();

        render(<ParametersInput parameters={parameters} onChange={onChange} workflowParameters={workflowParameters} />);

        expect(screen.getByText('adv-setting')).toBeInTheDocument();
        expect(screen.queryByText('std-setting')).not.toBeInTheDocument();
    });

    it('updates visibility dynamically when controlling parameter changes', () => {
        function InteractiveForm() {
            const [params, setParams] = useState<Parameter[]>([
                {name: 'mode', value: 'standard'},
                {name: 'cluster-size', value: '3', when: '{{inputs.parameters.mode}} == "advanced"'},
                {name: 'region', value: 'us-east-1', when: '{{inputs.parameters.mode}} != "advanced"'}
            ]);

            return <ParametersInput parameters={params} onChange={setParams} />;
        }

        render(<InteractiveForm />);

        // Initially in standard mode
        expect(screen.getByText('region')).toBeInTheDocument();
        expect(screen.queryByText('cluster-size')).not.toBeInTheDocument();

        // Change mode to advanced
        const modeInput = screen.getByDisplayValue('standard');
        fireEvent.change(modeInput, {target: {value: 'advanced'}});

        // cluster-size should now be visible and region hidden
        expect(screen.getByText('cluster-size')).toBeInTheDocument();
        expect(screen.queryByText('region')).not.toBeInTheDocument();
    });

    it('preserves hidden parameter values and reapplies them when visible again', () => {
        let currentParams: Parameter[] = [
            {name: 'mode', value: 'advanced'},
            {name: 'cluster-size', value: 'initial-size', when: '{{inputs.parameters.mode}} == "advanced"'}
        ];

        function InteractiveForm() {
            const [params, setParams] = useState<Parameter[]>(currentParams);

            const handleChange = (newParams: Parameter[]) => {
                currentParams = newParams;
                setParams(newParams);
            };

            return <ParametersInput parameters={params} onChange={handleChange} />;
        }

        render(<InteractiveForm />);

        // Edit cluster-size to custom value
        const clusterSizeInput = screen.getByDisplayValue('initial-size');
        fireEvent.change(clusterSizeInput, {target: {value: 'custom-99'}});

        expect(currentParams.find(p => p.name === 'cluster-size')?.value).toBe('custom-99');

        // Now change mode to 'simple', hiding cluster-size
        const modeInput = screen.getByDisplayValue('advanced');
        fireEvent.change(modeInput, {target: {value: 'simple'}});

        // cluster-size is not rendered in DOM
        expect(screen.queryByText('cluster-size')).not.toBeInTheDocument();

        // But cluster-size value custom-99 is still preserved in state
        expect(currentParams.find(p => p.name === 'cluster-size')?.value).toBe('custom-99');

        // Switch mode back to 'advanced'
        const modeInputUpdated = screen.getByDisplayValue('simple');
        fireEvent.change(modeInputUpdated, {target: {value: 'advanced'}});

        // cluster-size reappears with value 'custom-99'
        expect(screen.getByText('cluster-size')).toBeInTheDocument();
        expect(screen.getByDisplayValue('custom-99')).toBeInTheDocument();
    });

    it('continues supporting enum select fields and textarea fields', () => {
        const parameters: Parameter[] = [
            {name: 'select-param', value: 'opt1', enum: ['opt1', 'opt2', 'opt3']},
            {name: 'text-param', value: 'multi\nline', description: 'Help tooltip'}
        ];
        const onChange = jest.fn();

        const {container} = render(<ParametersInput parameters={parameters} onChange={onChange} />);

        // Description tooltip icon
        expect(document.querySelector('.fa-question-circle')).toBeInTheDocument();

        // Textarea field
        const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
        expect(textarea).toBeInTheDocument();
        expect(textarea.value).toBe('multi\nline');

        fireEvent.change(textarea, {target: {value: 'new text'}});
        expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({name: 'text-param', value: 'new text'})]));
    });
});
