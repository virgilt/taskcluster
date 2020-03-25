import React, { Component, Fragment } from 'react';
import { withStyles } from '@material-ui/core';
import Label from '@mozilla-frontend-infra/components/Label';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';
import Typography from '@material-ui/core/Typography';
import LinkIcon from 'mdi-react/LinkIcon';
import { pipe, map, sort as rSort } from 'ramda';
import { withRouter } from 'react-router-dom';
import memoize from 'fast-memoize';
import ConnectionDataTable from '../ConnectionDataTable';
import sort from '../../utils/sort';
import Link from '../../utils/Link';
import TableCellItem from '../TableCellItem';
import {
  NULL_PROVIDER,
  VIEW_WORKER_POOLS_PAGE_SIZE,
} from '../../utils/constants';
import { WorkerPools } from '../../utils/prop-types';

const sorted = pipe(
  rSort((a, b) => sort(a.node.name, b.node.name)),
  map(({ node: { name } }) => name)
);

@withRouter
@withStyles(theme => ({
  button: {
    marginLeft: -theme.spacing(2),
    marginRight: theme.spacing(1),
    borderRadius: 4,
  },
  linksIcon: {
    marginRight: theme.spacing(1),
  },
  linksButton: {
    marginRight: theme.spacing(3),
  },
}))
export default class WorkerManagerWorkerPoolsTable extends Component {
  static propTypes = {
    workerPoolsConnection: WorkerPools.isRequired,
  };

  state = {
    sortBy: 'workerPoolId',
    sortDirection: 'asc',
  };

  createSortedWorkerPoolsConnection = memoize(
    (workerPoolsConnection, sortBy, sortDirection) => {
      if (!sortBy) {
        return workerPoolsConnection;
      }

      return {
        ...workerPoolsConnection,
        edges: [...workerPoolsConnection.edges].sort((a, b) => {
          const firstElement =
            sortDirection === 'desc'
              ? this.valueFromNode(b.node)
              : this.valueFromNode(a.node);
          const secondElement =
            sortDirection === 'desc'
              ? this.valueFromNode(a.node)
              : this.valueFromNode(b.node);

          return sort(firstElement, secondElement);
        }),
      };
    },
    {
      serializer: ([workerPoolsConnection, sortBy, sortDirection]) => {
        const ids = sorted(workerPoolsConnection.edges);

        return `${ids.join('-')}-${sortBy}-${sortDirection}`;
      },
    }
  );

  valueFromNode(node) {
    const mapping = {
      'Worker Pool Id': node.workerPoolId,
    };

    return mapping[this.state.sortBy];
  }

  handleHeaderClick = header => {
    const toggled = this.state.sortDirection === 'desc' ? 'asc' : 'desc';
    const sortDirection = this.state.sortBy === header.id ? toggled : 'desc';

    this.setState({ sortBy: header.id, sortDirection });
  };

  renderRow = edge => {
    const {
      match: { path },
      classes,
    } = this.props;
    const { node: workerPool } = edge;
    const iconSize = 16;

    return (
      <TableRow key={workerPool.workerPoolId}>
        <TableCell>
          <Link to={`${path}/${encodeURIComponent(workerPool.workerPoolId)}`}>
            <TableCellItem button>
              {workerPool.workerPoolId}
              <LinkIcon size={iconSize} />
            </TableCellItem>
          </Link>
        </TableCell>

        <TableCell>
          {workerPool.providerId !== NULL_PROVIDER ? (
            <Typography variant="body2">{workerPool.providerId}</Typography>
          ) : (
            <em>n/a</em>
          )}
        </TableCell>

        <TableCell>{workerPool.pendingTasks}</TableCell>

        <TableCell>
          {workerPool.providerId !== NULL_PROVIDER ? (
            <Fragment />
          ) : (
            <Label mini status="warning" className={classes.button}>
              Scheduled for deletion
            </Label>
          )}
        </TableCell>
      </TableRow>
    );
  };

  render() {
    const { onPageChange, workerPoolsConnection } = this.props;
    const { sortBy, sortDirection } = this.state;
    const sortedWorkerPoolsConnection = this.createSortedWorkerPoolsConnection(
      workerPoolsConnection,
      sortBy,
      sortDirection
    );
    const headers = ['Worker Pool ID', 'Provider ID', 'Pending Tasks', ''];

    return (
      <Fragment>
        <ConnectionDataTable
          connection={sortedWorkerPoolsConnection}
          pageSize={VIEW_WORKER_POOLS_PAGE_SIZE}
          headers={headers}
          sortByLabel={sortBy}
          sortDirection={sortDirection}
          onPageChange={onPageChange}
          size="small"
          onHeaderClick={this.handleHeaderClick}
          renderRow={this.renderRow}
        />
      </Fragment>
    );
  }
}
