import { hot } from 'react-hot-loader';
import React, { Component, Fragment } from 'react';
import { withApollo, graphql } from 'react-apollo';
import { withStyles } from '@material-ui/core';
import { bool } from 'prop-types';
import Spinner from '@mozilla-frontend-infra/components/Spinner';
import Typography from '@material-ui/core/Typography';
import Chip from '@material-ui/core/Chip';
import Badge from '@material-ui/core/Badge';
import AssignmentIcon from 'mdi-react/AssignmentIcon';
import WarningIcon from 'mdi-react/WarningIcon';
import Dashboard from '../../../components/Dashboard';
import createWorkerPoolQuery from './createWorkerPool.graphql';
import updateWorkerPoolQuery from './updateWorkerPool.graphql';
import workerPoolQuery from './workerPool.graphql';
import providersQuery from './providers.graphql';
import WMWorkerPoolEditor from '../../../components/WMWorkerPoolEditor';
import ErrorPanel from '../../../components/ErrorPanel';
import Breadcrumbs from '../../../components/Breadcrumbs';
import Link from '../../../utils/Link';
import { NULL_PROVIDER } from '../../../utils/constants';

@hot(module)
@withApollo
@withStyles(theme => ({
  chip: {
    margin: `${theme.spacing(1)}px ${theme.spacing(1)}px 0 0`,
  },
}))
@graphql(providersQuery, {
  name: 'providersData',
})
@graphql(workerPoolQuery, {
  skip: props => !props.match.params.workerPoolId || props.isNewWorkerPool,
  options: ({ match: { params } }) => ({
    fetchPolicy: 'network-only',
    variables: {
      workerPoolId: decodeURIComponent(params.workerPoolId),
    },
  }),
})
export default class WMEditWorkerPool extends Component {
  state = {
    dialogError: null,
    dialogOpen: false,
  };

  static defaultProps = {
    isNewWorkerPool: false,
  };

  static propTypes = {
    isNewWorkerPool: bool,
  };

  createWorkerPoolRequest = async ({ workerPoolId, payload }) => {
    await this.props.client.mutate({
      mutation: createWorkerPoolQuery,
      variables: {
        workerPoolId,
        payload,
      },
    });
  };

  updateWorkerPoolRequest = async ({ workerPoolId, payload }) => {
    await this.props.client.mutate({
      mutation: updateWorkerPoolQuery,
      variables: {
        workerPoolId,
        payload,
      },
    });
  };

  deleteRequest = ({ workerPoolId, payload }) => {
    this.setState({ dialogError: null });

    return this.props.client.mutate({
      mutation: updateWorkerPoolQuery,
      variables: {
        workerPoolId,
        payload: {
          ...payload,
          providerId: NULL_PROVIDER, // this is how we delete worker pools
        },
      },
    });
  };

  handleDialogActionError = error => {
    this.setState({ dialogError: error });
  };

  handleDialogActionComplete = () => {
    this.props.history.push('/worker-manager');
  };

  handleDialogActionClose = () => {
    this.setState({
      dialogOpen: false,
      dialogError: null,
    });
  };

  handleDialogActionOpen = () => {
    this.setState({ dialogOpen: true });
  };

  render() {
    const { dialogError, dialogOpen } = this.state;
    const {
      isNewWorkerPool,
      data,
      providersData,
      classes,
      match: { params },
    } = this.props;

    // detect a ridiculous number of providers and let the user know
    if (
      providersData.providers &&
      providersData.providers.pageInfo.hasNextPage
    ) {
      const err = new Error(
        'This deployment has a lot of providers; not all can be displayed here.'
      );

      return <ErrorPanel fixed error={err} />;
    }

    const providers = providersData.providers
      ? providersData.providers.edges.map(({ node }) => node)
      : [];
    const loading =
      !providersData ||
      !providersData.providers ||
      providersData.loading ||
      (!isNewWorkerPool && (!data || !data.workerPool || data.loading));
    const error =
      (providersData && providersData.error) || (data && data.error);

    return (
      <Dashboard title={isNewWorkerPool ? 'Create Worker Pool' : 'Worker Pool'}>
        <ErrorPanel fixed error={error} />
        {loading && <Spinner loading />}
        {!loading &&
          (isNewWorkerPool ? (
            <WMWorkerPoolEditor
              saveRequest={this.createWorkerPoolRequest}
              providers={providers}
              isNewWorkerPool
            />
          ) : (
            <Fragment>
              <Breadcrumbs>
                <Link to="/workerpools">
                  <Typography variant="body2">root</Typography>
                </Link>
                <Typography variant="body2" color="textSecondary">
                  {`${decodeURIComponent(params.workerPoolId)}`}
                </Typography>
              </Breadcrumbs>
              <br />
              <div>
                <Chip
                  className={classes.chip}
                  icon={
                    <Badge
                      showZero
                      color="secondary"
                      anchorOrigin={{
                        horizontal: 'left',
                        vertical: 'top',
                      }}
                      max={100000}
                      badgeContent={data.workerPool.pendingTasks}>
                      <AssignmentIcon />
                    </Badge>
                  }
                  label="Pending Tasks"
                />
                {data.workerPool.providerId === NULL_PROVIDER && (
                  <Chip
                    className={classes.chip}
                    icon={<WarningIcon />}
                    label="Scheduled For Deletion"
                  />
                )}
              </div>
              <WMWorkerPoolEditor
                workerPool={data.workerPool}
                providers={providers}
                saveRequest={this.updateWorkerPoolRequest}
                deleteRequest={this.deleteRequest}
                dialogError={dialogError}
                dialogOpen={dialogOpen}
                onDialogActionError={this.handleDialogActionError}
                onDialogActionComplete={this.handleDialogActionComplete}
                onDialogActionClose={this.handleDialogActionClose}
                onDialogActionOpen={this.handleDialogActionOpen}
              />
            </Fragment>
          ))}
      </Dashboard>
    );
  }
}
