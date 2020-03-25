import { hot } from 'react-hot-loader';
import React, { Component, Fragment } from 'react';
import { withApollo, graphql } from 'react-apollo';
import PlusIcon from 'mdi-react/PlusIcon';
import escapeStringRegexp from 'escape-string-regexp';
import dotProp from 'dot-prop-immutable';
import Typography from '@material-ui/core/Typography';
import { withStyles } from '@material-ui/core/styles';
import Spinner from '@mozilla-frontend-infra/components/Spinner';
import Dashboard from '../../../components/Dashboard';
import workerPoolsQuery from './WMWorkerPools.graphql';
import ErrorPanel from '../../../components/ErrorPanel';
import WorkerManagerWorkerPoolsTable from '../../../components/WMWorkerPoolsTable';
import Search from '../../../components/Search';
import Breadcrumbs from '../../../components/Breadcrumbs';
import Button from '../../../components/Button';
import { VIEW_WORKER_POOLS_PAGE_SIZE } from '../../../utils/constants';

@hot(module)
@withApollo
@graphql(workerPoolsQuery, {
  options: () => ({
    fetchPolicy: 'network-only', // so that it refreshes view after editing/creating
    variables: {
      secretsConnection: {
        limit: VIEW_WORKER_POOLS_PAGE_SIZE,
      },
    },
  }),
})
@withStyles(theme => ({
  createIconSpan: {
    ...theme.mixins.fab,
    ...theme.mixins.actionButton,
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
}))
export default class WorkerManagerWorkerPoolsView extends Component {
  state = {
    workerPoolSearch: '',
  };

  handleWorkerPoolSearchSubmit = workerPoolSearch => {
    this.setState({ workerPoolSearch });
  };

  handleCreate = () => {
    this.props.history.push(`${this.props.match.path}/create`);
  };

  handlePageChange = ({ cursor, previousCursor }) => {
    const {
      data: { fetchMore },
    } = this.props;

    return fetchMore({
      query: workerPoolsQuery,
      variables: {
        secretsConnection: {
          limit: VIEW_WORKER_POOLS_PAGE_SIZE,
          cursor,
          previousCursor,
        },
        filter: this.state.workerPoolSearch
          ? {
              name: {
                $regex: escapeStringRegexp(this.state.workerPoolSearch),
                $options: 'i',
              },
            }
          : null,
      },
      updateQuery(previousResult, { fetchMoreResult }) {
        const { edges, pageInfo } = fetchMoreResult.secrets;

        return dotProp.set(previousResult, 'secrets', workerPools =>
          dotProp.set(
            dotProp.set(workerPools, 'edges', edges),
            'pageInfo',
            pageInfo
          )
        );
      },
    });
  };

  render() {
    const {
      data: { loading, error, workerPools },
      classes,
    } = this.props;

    return (
      <Dashboard
        title="Worker Pools"
        search={
          <Search
            disabled={loading}
            onSubmit={this.handleWorkerPoolSearchSubmit}
            placeholder="workerPoolId contains"
          />
        }>
        <Fragment>
          <Breadcrumbs>
            <Typography variant="body2" className={classes.link}>
              root
            </Typography>
          </Breadcrumbs>
          {!workerPools && loading && <Spinner loading />}
          <ErrorPanel fixed error={error} />
          {workerPools && (
            <Fragment>
              <WorkerManagerWorkerPoolsTable
                onPageChange={this.handlePageChange}
                workerPoolsConnection={workerPools}
              />
            </Fragment>
          )}
          <Button
            spanProps={{ className: classes.createIconSpan }}
            tooltipProps={{ title: 'Create Worker Pool' }}
            requiresAuth
            color="secondary"
            variant="round"
            onClick={this.handleCreate}>
            <PlusIcon />
          </Button>
        </Fragment>
      </Dashboard>
    );
  }
}
