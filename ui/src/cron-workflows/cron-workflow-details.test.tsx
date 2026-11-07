import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createBrowserHistory} from 'history';
import React from 'react';
import {Router} from 'react-router';

import {Context, ContextApis} from '../shared/context';
import {CronWorkflow, Parameter, WorkflowTemplate} from '../shared/models';
import {services} from '../shared/services';
import {CronWorkflowDetails, mergeCronParameters} from './cron-workflow-details';

jest.mock('../shared/components/suspense-monaco-editor', () => ({
    // eslint-disable-next-line react/display-name, @typescript-eslint/no-unused-vars
    SuspenseMonacoEditor: React.forwardRef((props: any, _) => <textarea data-testid='editor' onChange={e => props.onChange(e.target.value)} />)
}));

describe('CronWorkflowDetails Submit Flow', () => {
    const history = createBrowserHistory();

    const mockNavigation = {
        goto: jest.fn()
    };

    const mockContext: ContextApis = {
        navigation: mockNavigation as any,
        notifications: {} as any,
        popup: {} as any,
        history: history as any
    };

    const fakeCronWorkflow: CronWorkflow = {
        metadata: {
            name: 'test-cron',
            namespace: 'argo'
        },
        spec: {
            schedules: ['0 * * * *'],
            workflowSpec: {
                entrypoint: 'whalesay',
                arguments: {
                    parameters: [
                        {name: 'message', value: 'hello cron'},
                        {name: 'verbose', value: 'true', when: '{{workflow.parameters.message}} == "hello cron"'}
                    ]
                },
                templates: [
                    {
                        name: 'whalesay',
                        inputs: {
                            parameters: [{name: 'repeat', value: '1'}]
                        }
                    }
                ]
            }
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(services.cronWorkflows, 'get').mockResolvedValue(fakeCronWorkflow);
        jest.spyOn(services.workflows, 'list').mockResolvedValue({items: []} as any);
        jest.spyOn(services.info, 'getInfo').mockResolvedValue({columns: []} as any);
    });

    it('opens parameter submission panel and submits with configured parameters', async () => {
        const submitSpy = jest.spyOn(services.workflows, 'submit').mockResolvedValue({
            metadata: {name: 'test-cron-run-1', namespace: 'argo'}
        } as any);

        const match = {
            params: {namespace: 'argo', name: 'test-cron'},
            isExact: true,
            path: '',
            url: ''
        };

        const location = {
            pathname: '/cron-workflows/argo/test-cron',
            search: '',
            state: {},
            hash: ''
        };

        const {container} = render(
            <Router history={history}>
                <Context.Provider value={mockContext}>
                    <CronWorkflowDetails match={match as any} location={location as any} history={history} />
                </Context.Provider>
            </Router>
        );

        // Wait for CronWorkflow to load
        await waitFor(() => {
            expect(screen.getByText('Submit')).toBeInTheDocument();
        });

        // Click Submit action in toolbar
        fireEvent.click(screen.getByText('Submit'));

        // The SlidingPanel with SubmitWorkflowPanel should be displayed
        await waitFor(() => {
            expect(screen.getByText('Submit Workflow')).toBeInTheDocument();
        });

        // Check that parameters are populated and visible
        expect(screen.getByText('message')).toBeInTheDocument();
        expect(screen.getByDisplayValue('hello cron')).toBeInTheDocument();
        expect(screen.getByText('verbose')).toBeInTheDocument();
        expect(screen.getByText('repeat')).toBeInTheDocument();

        // Submit the workflow from the panel
        const panelSubmitBtn = container.querySelector('.white-box button') as HTMLButtonElement;
        expect(panelSubmitBtn).toBeInTheDocument();
        fireEvent.click(panelSubmitBtn);

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalled();
        });

        expect(submitSpy).toHaveBeenCalledWith(
            'cronwf',
            'test-cron',
            'argo',
            expect.objectContaining({
                entryPoint: 'whalesay',
                parameters: expect.arrayContaining(['message=hello cron', 'verbose=true', 'repeat=1'])
            })
        );

        expect(mockNavigation.goto).toHaveBeenCalledWith(expect.stringContaining('workflows/argo/test-cron-run-1'));
    });

    it('waits for referenced template to resolve before mounting submit panel and populates parameters', async () => {
        let resolveTemplatePromise: (value: WorkflowTemplate) => void;
        const templatePromise = new Promise<WorkflowTemplate>(resolve => {
            resolveTemplatePromise = resolve;
        });

        const cronWithTemplateRef: CronWorkflow = {
            metadata: {
                name: 'cron-with-tmpl-ref',
                namespace: 'argo'
            },
            spec: {
                schedules: ['0 * * * *'],
                workflowSpec: {
                    workflowTemplateRef: {
                        name: 'my-referenced-template'
                    },
                    arguments: {
                        parameters: [{name: 'mode', value: 'advanced'}]
                    }
                }
            }
        };

        const referencedTmpl: WorkflowTemplate = {
            metadata: {name: 'my-referenced-template', namespace: 'argo'},
            spec: {
                entrypoint: 'main',
                arguments: {
                    parameters: [
                        {
                            name: 'mode',
                            default: 'standard',
                            enum: ['standard', 'advanced'],
                            description: 'Deployment mode'
                        },
                        {
                            name: 'cluster-size',
                            default: '3',
                            when: '{{workflow.parameters.mode}} == "advanced"'
                        }
                    ]
                },
                templates: [
                    {
                        name: 'main',
                        inputs: {
                            parameters: [{name: 'entry-param', value: 'entry-val'}]
                        }
                    }
                ]
            }
        };

        jest.spyOn(services.cronWorkflows, 'get').mockResolvedValue(cronWithTemplateRef);
        jest.spyOn(services.workflowTemplate, 'get').mockReturnValue(templatePromise as any);

        const match = {
            params: {namespace: 'argo', name: 'cron-with-tmpl-ref'},
            isExact: true,
            path: '',
            url: ''
        };

        // Navigate directly with ?sidePanel=submit
        const location = {
            pathname: '/cron-workflows/argo/cron-with-tmpl-ref',
            search: '?sidePanel=submit',
            state: {},
            hash: ''
        };

        render(
            <Router history={history}>
                <Context.Provider value={mockContext}>
                    <CronWorkflowDetails match={match as any} location={location as any} history={history} />
                </Context.Provider>
            </Router>
        );

        // While template is loading, SubmitWorkflowPanel should not be rendered with empty parameters
        expect(screen.queryByText('Submit Workflow')).not.toBeInTheDocument();

        // Resolve the referenced template asynchronously
        resolveTemplatePromise!(referencedTmpl);

        // Now SubmitWorkflowPanel should mount with the resolved template parameters
        await waitFor(() => {
            expect(screen.getByText('Submit Workflow')).toBeInTheDocument();
        });

        // Parameters from referenced template and cron overrides should now be present
        expect(screen.getByText('mode')).toBeInTheDocument();
        expect(screen.getAllByText('advanced').length).toBeGreaterThanOrEqual(1);
        // Condition cluster-size when mode == "advanced" is satisfied -> visible!
        expect(screen.getByText('cluster-size')).toBeInTheDocument();
        expect(screen.getByDisplayValue('3')).toBeInTheDocument();
        expect(screen.getByText('entry-param')).toBeInTheDocument();
    });
});

describe('mergeCronParameters', () => {
    it('preserves template metadata (enum, description, when, default) when overridden by cron parameter', () => {
        const templateParams: Parameter[] = [
            {
                name: 'mode',
                default: 'standard',
                enum: ['standard', 'advanced'],
                description: 'Deployment mode',
                when: '{{workflow.parameters.env}} == "prod"'
            }
        ];

        const cronParams: Parameter[] = [
            {
                name: 'mode',
                value: 'advanced'
            }
        ];

        const merged = mergeCronParameters(templateParams, cronParams);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual({
            name: 'mode',
            value: 'advanced', // overridden from cron
            default: 'standard', // preserved from template
            enum: ['standard', 'advanced'], // preserved from template
            description: 'Deployment mode', // preserved from template
            when: '{{workflow.parameters.env}} == "prod"' // preserved from template
        });
    });

    it('falls back to template value/default when cron parameter has no value override', () => {
        const templateParams: Parameter[] = [
            {name: 'p1', value: 'tmpl-val', default: 'tmpl-def'},
            {name: 'p2', default: 'tmpl-def-2'}
        ];

        const cronParams: Parameter[] = [
            {name: 'p1'}, // no value
            {name: 'p2'}
        ];

        const merged = mergeCronParameters(templateParams, cronParams);

        expect(merged).toHaveLength(2);
        expect(merged[0].value).toBe('tmpl-val');
        expect(merged[0].default).toBe('tmpl-def');
        expect(merged[1].default).toBe('tmpl-def-2');
    });

    it('appends additional CronWorkflow-only parameters not declared in the template', () => {
        const templateParams: Parameter[] = [{name: 'p1', value: 'v1'}];

        const cronParams: Parameter[] = [
            {name: 'p1', value: 'override-v1'},
            {name: 'cron-only-param', value: 'cron-val', description: 'extra param'}
        ];

        const merged = mergeCronParameters(templateParams, cronParams);

        expect(merged).toHaveLength(2);
        expect(merged[0].name).toBe('p1');
        expect(merged[0].value).toBe('override-v1');
        expect(merged[1].name).toBe('cron-only-param');
        expect(merged[1].value).toBe('cron-val');
    });

    it('preserves template parameter ordering', () => {
        const templateParams: Parameter[] = [
            {name: 'first', value: '1'},
            {name: 'second', value: '2'},
            {name: 'third', value: '3'}
        ];

        const cronParams: Parameter[] = [
            {name: 'third', value: '3-overridden'},
            {name: 'first', value: '1-overridden'}
        ];

        const merged = mergeCronParameters(templateParams, cronParams);

        expect(merged.map(p => p.name)).toEqual(['first', 'second', 'third']);
        expect(merged.map(p => p.value)).toEqual(['1-overridden', '2', '3-overridden']);
    });
});
