import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createBrowserHistory} from 'history';
import React from 'react';

import {Context, ContextApis} from '../../shared/context';
import {Parameter, Template} from '../../shared/models';
import {services} from '../../shared/services';
import {SubmitWorkflowPanel} from './submit-workflow-panel';

describe('SubmitWorkflowPanel', () => {
    const mockNavigation = {
        goto: jest.fn()
    };

    const history = createBrowserHistory();

    const mockContext: ContextApis = {
        navigation: mockNavigation as any,
        notifications: {} as any,
        popup: {} as any,
        history: history as any
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('populates initial entrypoint parameters on first render', () => {
        const templates: Template[] = [
            {
                name: 'main',
                inputs: {
                    parameters: [
                        {name: 'entry-param-1', value: 'init-val-1'},
                        {name: 'entry-param-2', default: 'init-def-2'}
                    ]
                }
            }
        ];

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='main'
                    templates={templates}
                    workflowParameters={[]}
                    history={history}
                />
            </Context.Provider>
        );

        // Parameters should be available and rendered immediately without user interaction
        expect(screen.getByText('entry-param-1')).toBeInTheDocument();
        expect(screen.getByDisplayValue('init-val-1')).toBeInTheDocument();
        expect(screen.getByText('entry-param-2')).toBeInTheDocument();
        expect(screen.getByDisplayValue('init-def-2')).toBeInTheDocument();
    });

    it('controls entrypoint parameter visibility via workflow arguments and updates reactively', () => {
        const workflowParameters: Parameter[] = [{name: 'deployment-mode', value: 'standard'}];

        const templates: Template[] = [
            {
                name: 'main',
                inputs: {
                    parameters: [
                        {name: 'cluster-size', value: '3', when: '{{workflow.parameters.deployment-mode}} == "advanced"'},
                        {name: 'region', value: 'us-east-1', when: '{{workflow.parameters.deployment-mode}} != "advanced"'}
                    ]
                }
            }
        ];

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='main'
                    templates={templates}
                    workflowParameters={workflowParameters}
                    history={history}
                />
            </Context.Provider>
        );

        // Initially in standard mode: region is visible, cluster-size is hidden
        expect(screen.getByText('region')).toBeInTheDocument();
        expect(screen.getByDisplayValue('us-east-1')).toBeInTheDocument();
        expect(screen.queryByText('cluster-size')).not.toBeInTheDocument();

        // Change deployment-mode to 'advanced'
        const modeInput = screen.getByDisplayValue('standard');
        fireEvent.change(modeInput, {target: {value: 'advanced'}});

        // cluster-size should now be visible and region hidden immediately
        expect(screen.getByText('cluster-size')).toBeInTheDocument();
        expect(screen.getByDisplayValue('3')).toBeInTheDocument();
        expect(screen.queryByText('region')).not.toBeInTheDocument();
    });

    it('preserves hidden parameter values upon workflow submission', async () => {
        const submitSpy = jest.spyOn(services.workflows, 'submit').mockResolvedValue({
            metadata: {name: 'submitted-wf', namespace: 'default'}
        } as any);

        const workflowParameters: Parameter[] = [{name: 'deployment-mode', value: 'standard'}];

        const templates: Template[] = [
            {
                name: 'main',
                inputs: {
                    parameters: [
                        {name: 'cluster-size', value: '5', when: '{{workflow.parameters.deployment-mode}} == "advanced"'},
                        {name: 'region', value: 'us-east-1', when: '{{workflow.parameters.deployment-mode}} != "advanced"'}
                    ]
                }
            }
        ];

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='main'
                    templates={templates}
                    workflowParameters={workflowParameters}
                    history={history}
                />
            </Context.Provider>
        );

        // In standard mode, cluster-size is hidden.
        expect(screen.queryByText('cluster-size')).not.toBeInTheDocument();

        // Submit workflow
        const submitBtn = screen.getByRole('button', {name: /submit/i});
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalledTimes(1);
        });

        // Parameters sent to backend should include both visible and hidden parameters with values
        const submittedOpts = submitSpy.mock.calls[0][3];
        expect(submittedOpts?.parameters).toContain('deployment-mode=standard');
        expect(submittedOpts?.parameters).toContain('cluster-size=5');
        expect(submittedOpts?.parameters).toContain('region=us-east-1');
    });

    it('handles switching entrypoints without carrying stale parameter values', () => {
        const templates: Template[] = [
            {
                name: 'template-a',
                inputs: {
                    parameters: [{name: 'param-a', value: 'val-a'}]
                }
            },
            {
                name: 'template-b',
                inputs: {
                    parameters: [{name: 'param-b', value: 'val-b'}]
                }
            }
        ];

        const {container} = render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='template-a'
                    templates={templates}
                    workflowParameters={[]}
                    history={history}
                />
            </Context.Provider>
        );

        expect(screen.getByText('param-a')).toBeInTheDocument();
        expect(screen.queryByText('param-b')).not.toBeInTheDocument();

        // Find the select for entrypoint and switch to template-b
        const entrypointSelect = container.querySelector('.select__options');
        expect(entrypointSelect).toBeInTheDocument();

        // Select template-b
        const optionB = screen.getByText('template-b');
        fireEvent.click(optionB);

        // Now param-b should be displayed and param-a should not be present
        expect(screen.getByText('param-b')).toBeInTheDocument();
        expect(screen.getByDisplayValue('val-b')).toBeInTheDocument();
        expect(screen.queryByText('param-a')).not.toBeInTheDocument();
    });

    it('submits CronWorkflow using cronwf resourceKind and navigates', async () => {
        const submitSpy = jest.spyOn(services.workflows, 'submit').mockResolvedValue({
            metadata: {name: 'cron-wf-run-1', namespace: 'prod'}
        } as any);

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='CronWorkflow'
                    namespace='prod'
                    name='my-cron'
                    entrypoint='main'
                    templates={[{name: 'main', inputs: {parameters: [{name: 'p1', value: 'v1'}]}}]}
                    workflowParameters={[{name: 'wf-p', value: 'wf-v'}]}
                    history={history}
                />
            </Context.Provider>
        );

        const submitBtn = screen.getByRole('button', {name: /submit/i});
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalledTimes(1);
        });

        expect(submitSpy).toHaveBeenCalledWith(
            'cronwf',
            'my-cron',
            'prod',
            expect.objectContaining({
                entryPoint: 'main',
                parameters: ['wf-p=wf-v', 'p1=v1']
            })
        );
        expect(mockNavigation.goto).toHaveBeenCalledWith(expect.stringContaining('workflows/prod/cron-wf-run-1'));
    });

    it('demonstrates submission behavior for hidden parameters with defaults, explicit values, and without values/defaults', async () => {
        const submitSpy = jest.spyOn(services.workflows, 'submit').mockResolvedValue({
            metadata: {name: 'submitted-wf', namespace: 'default'}
        } as any);

        const workflowParameters: Parameter[] = [{name: 'mode', value: 'standard'}];

        const templates: Template[] = [
            {
                name: 'main',
                inputs: {
                    parameters: [
                        // Hidden param with default
                        {name: 'hidden-with-default', default: 'default-val', when: '{{workflow.parameters.mode}} == "advanced"'},
                        // Hidden param with explicit value
                        {name: 'hidden-with-value', value: 'explicit-val', when: '{{workflow.parameters.mode}} == "advanced"'},
                        // Hidden param without value or default (required in backend)
                        {name: 'hidden-without-val-or-default', when: '{{workflow.parameters.mode}} == "advanced"'},
                        // Visible param
                        {name: 'visible-param', value: 'visible-val', when: '{{workflow.parameters.mode}} == "standard"'}
                    ]
                }
            }
        ];

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='main'
                    templates={templates}
                    workflowParameters={workflowParameters}
                    history={history}
                />
            </Context.Provider>
        );

        // All hidden parameters are not visible in UI
        expect(screen.queryByText('hidden-with-default')).not.toBeInTheDocument();
        expect(screen.queryByText('hidden-with-value')).not.toBeInTheDocument();
        expect(screen.queryByText('hidden-without-val-or-default')).not.toBeInTheDocument();
        // Visible parameter is rendered
        expect(screen.getByText('visible-param')).toBeInTheDocument();

        // Submit in standard mode
        const submitBtn = screen.getByRole('button', {name: /submit/i});
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalledTimes(1);
        });

        const submittedParams = submitSpy.mock.calls[0][3]?.parameters || [];
        // Hidden parameters with defaults or explicit values ARE submitted
        expect(submittedParams).toContain('hidden-with-default=default-val');
        expect(submittedParams).toContain('hidden-with-value=explicit-val');
        // Hidden parameter without value or default has undefined value and is NOT submitted
        expect(submittedParams.some((p: string) => p.startsWith('hidden-without-val-or-default='))).toBe(false);
    });

    it('submits updated values when a parameter becomes visible after its condition changes', async () => {
        const submitSpy = jest.spyOn(services.workflows, 'submit').mockResolvedValue({
            metadata: {name: 'submitted-wf', namespace: 'default'}
        } as any);

        const workflowParameters: Parameter[] = [{name: 'mode', value: 'standard'}];

        const templates: Template[] = [
            {
                name: 'main',
                inputs: {
                    parameters: [{name: 'conditional-param', default: 'original-default', when: '{{workflow.parameters.mode}} == "advanced"'}]
                }
            }
        ];

        render(
            <Context.Provider value={mockContext}>
                <SubmitWorkflowPanel
                    kind='WorkflowTemplate'
                    namespace='default'
                    name='test-tmpl'
                    entrypoint='main'
                    templates={templates}
                    workflowParameters={workflowParameters}
                    history={history}
                />
            </Context.Provider>
        );

        // Initially hidden
        expect(screen.queryByText('conditional-param')).not.toBeInTheDocument();

        // Change mode to 'advanced' to make parameter visible
        const modeInput = screen.getByDisplayValue('standard');
        fireEvent.change(modeInput, {target: {value: 'advanced'}});

        // Parameter is now visible
        expect(screen.getByText('conditional-param')).toBeInTheDocument();

        // User edits the parameter
        const paramInput = screen.getByDisplayValue('original-default');
        fireEvent.change(paramInput, {target: {value: 'user-custom-value'}});

        // Submit workflow
        const submitBtn = screen.getByRole('button', {name: /submit/i});
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalledTimes(1);
        });

        const submittedParams = submitSpy.mock.calls[0][3]?.parameters || [];
        expect(submittedParams).toContain('mode=advanced');
        expect(submittedParams).toContain('conditional-param=user-custom-value');
    });
});
