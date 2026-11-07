import {NotificationType} from 'argo-ui/src/components/notifications/notifications';
import {Page} from 'argo-ui/src/components/page/page';
import {SlidingPanel} from 'argo-ui/src/components/sliding-panel/sliding-panel';
import * as React from 'react';
import {useContext, useEffect, useRef, useState} from 'react';
import {RouteComponentProps} from 'react-router';

import {uiUrl} from '../shared/base';
import {ErrorNotice} from '../shared/components/error-notice';
import {openLinkWithKey} from '../shared/components/links';
import {Loading} from '../shared/components/loading';
import {ZeroState} from '../shared/components/zero-state';
import {Context} from '../shared/context';
import {historyUrl} from '../shared/history';
import * as models from '../shared/models';
import {ClusterWorkflowTemplate, CronWorkflow, Link, Parameter, Workflow, WorkflowTemplate} from '../shared/models';
import {services} from '../shared/services';
import {useCollectEvent} from '../shared/use-collect-event';
import {useEditableObject} from '../shared/use-editable-object';
import {useQueryParams} from '../shared/use-query-params';
import {WidgetGallery} from '../widgets/widget-gallery';
import {SubmitWorkflowPanel} from '../workflows/components/submit-workflow-panel';
import {WorkflowDetailsList} from '../workflows/components/workflow-details-list/workflow-details-list';
import {CronWorkflowEditor} from './cron-workflow-editor';

import '../workflows/components/workflow-details/workflow-details.scss';

export function mergeCronParameters(templateParams: Parameter[] = [], cronParams: Parameter[] = []): Parameter[] {
    const cronMap = new Map((cronParams || []).map(p => [p.name, p]));
    const seen = new Set<string>();
    const result: Parameter[] = [];

    for (const tp of templateParams || []) {
        seen.add(tp.name);
        const cp = cronMap.get(tp.name);
        if (cp) {
            result.push({
                ...tp,
                ...cp,
                enum: cp.enum !== undefined ? cp.enum : tp.enum,
                description: cp.description !== undefined ? cp.description : tp.description,
                when: cp.when !== undefined ? cp.when : tp.when,
                default: cp.default !== undefined ? cp.default : tp.default,
                value: cp.value !== undefined ? cp.value : tp.value
            });
        } else {
            result.push(tp);
        }
    }

    for (const cp of cronParams || []) {
        if (!seen.has(cp.name)) {
            result.push(cp);
        }
    }

    return result;
}

export function CronWorkflowDetails({match, location, history}: RouteComponentProps<any>) {
    // boiler-plate
    const {navigation, notifications, popup} = useContext(Context);
    const queryParams = new URLSearchParams(location.search);

    const isFirstRender = useRef(true);
    const [namespace] = useState(match.params.namespace);
    const [name] = useState(match.params.name);
    const [sidePanel, setSidePanel] = useState(queryParams.get('sidePanel'));
    const [tab, setTab] = useState(queryParams.get('tab'));
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [columns, setColumns] = useState<models.Column[]>([]);

    const [referencedTemplate, setReferencedTemplate] = useState<WorkflowTemplate | ClusterWorkflowTemplate | null>(null);
    const {object: cronWorkflow, setObject: setCronWorkflow, resetObject: resetCronWorkflow, serialization, edited, lang, setLang} = useEditableObject<CronWorkflow>();
    const [error, setError] = useState<Error>();

    useEffect(() => {
        const tmplRef = cronWorkflow?.spec?.workflowSpec?.workflowTemplateRef;
        if (!tmplRef) {
            setReferencedTemplate(null);
            return;
        }
        if (tmplRef.clusterScope) {
            services.clusterWorkflowTemplate.get(tmplRef.name).then(setReferencedTemplate).catch(setError);
        } else {
            services.workflowTemplate.get(tmplRef.name, namespace).then(setReferencedTemplate).catch(setError);
        }
    }, [cronWorkflow, namespace]);

    useEffect(
        useQueryParams(history, p => {
            setSidePanel(p.get('sidePanel'));
            setTab(p.get('tab'));
        }),
        [history]
    );

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        history.push(
            historyUrl('cron-workflows/{namespace}/{name}', {
                namespace,
                name,
                sidePanel,
                tab
            })
        );
    }, [namespace, name, sidePanel, tab]);

    useEffect(() => {
        services.cronWorkflows
            .get(name, namespace)
            .then(resetCronWorkflow)
            .then(() => setError(null))
            .catch(setError);
    }, [namespace, name]);

    useEffect(() => {
        (async () => {
            const workflowList = await services.workflows.list(namespace, null, [`${models.labels.cronWorkflow}=${name}`], {limit: 50});
            const workflowsInfo = await services.info.getInfo();

            setWorkflows(workflowList.items);
            setColumns(workflowsInfo.columns);
        })();
    }, []);

    useCollectEvent('openedCronWorkflowDetails');

    const suspendButton =
        cronWorkflow && !cronWorkflow.spec.suspend
            ? {
                  title: 'Suspend',
                  iconClassName: 'fa fa-pause',
                  action: () =>
                      services.cronWorkflows
                          .suspend(name, namespace)
                          .then(resetCronWorkflow)
                          .then(() => setError(null))
                          .catch(setError),
                  disabled: !cronWorkflow || edited
              }
            : {
                  title: 'Resume',
                  iconClassName: 'fa fa-play',
                  action: () =>
                      services.cronWorkflows
                          .resume(name, namespace)
                          .then(resetCronWorkflow)
                          .then(() => setError(null))
                          .catch(setError),
                  disabled: !cronWorkflow || !cronWorkflow.spec.suspend || edited
              };

    const getItems = () => {
        const items = [
            {
                title: 'Submit',
                iconClassName: 'fa fa-plus',
                disabled: edited,
                action: () => setSidePanel('submit')
            },
            {
                title: 'Update',
                iconClassName: 'fa fa-save',
                disabled: !edited,
                action: () => {
                    // magic - we get the latest from the server and then apply the changes from the rendered version to this
                    return services.cronWorkflows
                        .get(name, namespace)
                        .then(latest =>
                            services.cronWorkflows.update(
                                {
                                    ...latest,
                                    spec: cronWorkflow.spec,
                                    metadata: {...cronWorkflow.metadata, resourceVersion: latest.metadata.resourceVersion}
                                },
                                cronWorkflow.metadata.name,
                                cronWorkflow.metadata.namespace
                            )
                        )
                        .then(resetCronWorkflow)
                        .then(() => notifications.show({content: 'Updated', type: NotificationType.Success}))
                        .then(() => setError(null))
                        .catch(setError);
                }
            },
            suspendButton,
            {
                title: 'Delete',
                iconClassName: 'fa fa-trash',
                disabled: edited,
                action: () => {
                    popup.confirm('confirm', 'Are you sure you want to delete this cron workflow? (This also deletes all Workflows it spawned)').then(yes => {
                        if (yes) {
                            services.cronWorkflows
                                .delete(name, namespace)
                                .then(() => navigation.goto(uiUrl('cron-workflows/' + namespace)))
                                .then(() => setError(null))
                                .catch(setError);
                        }
                    });
                }
            },
            {
                title: 'Share',
                iconClassName: 'fa fa-share-alt',
                action: () => setSidePanel('share')
            }
        ];

        if (cronWorkflow?.spec?.workflowSpec?.workflowTemplateRef) {
            const templateName = cronWorkflow.spec.workflowSpec.workflowTemplateRef.name;
            const clusterScope = cronWorkflow.spec.workflowSpec.workflowTemplateRef.clusterScope;
            const url: string = clusterScope ? uiUrl(`cluster-workflow-templates/${templateName}`) : uiUrl(`workflow-templates/${cronWorkflow.metadata.namespace}/${templateName}`);
            const icon: string = clusterScope ? 'fa fa-window-restore' : 'fa fa-window-maximize';

            const templateLink: Link = {
                name: 'Open Workflow Template',
                scope: 'workflow',
                url
            };

            items.push({
                title: templateLink.name,
                iconClassName: icon,
                action: () => openLinkWithKey(templateLink.url)
            });
        }

        return items;
    };

    const hasTemplateRef = !!cronWorkflow?.spec?.workflowSpec?.workflowTemplateRef;
    const isTemplateLoading = hasTemplateRef && !referencedTemplate;

    return (
        <Page
            title='Cron Workflow Details'
            toolbar={{
                breadcrumbs: [
                    {title: 'Cron Workflows', path: uiUrl('cron-workflows')},
                    {title: namespace, path: uiUrl('cron-workflows/' + namespace)},
                    {title: name, path: uiUrl('cron-workflows/' + namespace + '/' + name)}
                ],
                actionMenu: {
                    items: getItems()
                }
            }}>
            <>
                <ErrorNotice error={error} />
                {!cronWorkflow ? (
                    <Loading />
                ) : (
                    <CronWorkflowEditor
                        cronWorkflow={cronWorkflow}
                        serialization={serialization}
                        lang={lang}
                        onLangChange={setLang}
                        onChange={setCronWorkflow}
                        onError={setError}
                        selectedTabKey={tab}
                        onTabSelected={setTab}
                    />
                )}
                <SlidingPanel isShown={!!sidePanel} onClose={() => setSidePanel(null)} isMiddle={sidePanel === 'submit'}>
                    {sidePanel === 'submit' &&
                        cronWorkflow &&
                        (isTemplateLoading ? (
                            <Loading />
                        ) : (
                            <SubmitWorkflowPanel
                                kind='CronWorkflow'
                                namespace={namespace}
                                name={name}
                                entrypoint={cronWorkflow.spec?.workflowSpec?.entrypoint || referencedTemplate?.spec?.entrypoint || ''}
                                templates={
                                    cronWorkflow.spec?.workflowSpec?.templates && cronWorkflow.spec.workflowSpec.templates.length > 0
                                        ? cronWorkflow.spec.workflowSpec.templates
                                        : referencedTemplate?.spec?.templates || []
                                }
                                workflowParameters={mergeCronParameters(referencedTemplate?.spec?.arguments?.parameters, cronWorkflow.spec?.workflowSpec?.arguments?.parameters)}
                                workflowArtifacts={cronWorkflow.spec?.workflowSpec?.arguments?.artifacts || referencedTemplate?.spec?.arguments?.artifacts || []}
                                history={history}
                            />
                        ))}
                    {sidePanel === 'share' && <WidgetGallery namespace={namespace} label={'workflows.argoproj.io/cron-workflow=' + name} />}
                </SlidingPanel>
                <>
                    <ErrorNotice error={error} />
                    {!workflows ? (
                        <ZeroState title='No completed cron workflows'>
                            <p> You can create new cron workflows here or using the CLI. </p>
                        </ZeroState>
                    ) : (
                        <WorkflowDetailsList workflows={workflows} columns={columns} />
                    )}
                </>
            </>
        </Page>
    );
}
