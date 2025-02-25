import SQL from 'sql-template-strings';
import moment from 'moment';
import { CacheKeys } from '@/constants';
import { runQuery } from '@/helpers';

export const getAllClientTodos = async poolClient => {
  const cacheKey = CacheKeys.clientTodosKey('all');

  const rows = await runQuery(
    SQL`
      SELECT *  FROM client_todos;
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getClientTodos = async (clientId, poolClient) => {
  const cacheKey = CacheKeys.clientTodosKey(clientId);

  const rows = await runQuery(
    SQL`
      SELECT *  FROM client_todos
      WHERE client_id = ${clientId};
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows : [];
};

export const getClientTodo = async (clientId, todoId, poolClient) => {
  const cacheKey = CacheKeys.clientTodoKey(clientId, todoId);

  const rows = await runQuery(
    SQL`
      SELECT *  FROM client_todos
      WHERE id = ${todoId}
      AND client_id = ${clientId}
    `,
    cacheKey,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const createNewClientTodo = async (data, poolClient) => {
  const { clientId, todo, isComplete } = data;

  const createdAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    INSERT INTO client_todos (client_id, todo, is_complete, created_at, updated_at)
      VALUES (${clientId}, ${todo}, ${isComplete}, ${createdAt}, ${createdAt})
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const updateClientTodo = async (todoId, data, poolClient) => {
  const { todo, isComplete } = data;

  const updatedAt = moment().toISOString();

  const rows = await runQuery(
    SQL`
    UPDATE client_todos
    SET
    todo = ${todo},
    is_complete = ${isComplete},
    updated_at = ${updatedAt}
    WHERE id = ${todoId}
      RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export const deleteClientTodo = async (todoId, poolClient) => {
  const rows = await runQuery(
    SQL`
    DELETE FROM client_todos
    WHERE id = ${todoId}
    RETURNING *;
  `,
    null,
    null,
    poolClient
  );

  return rows && rows.length ? rows[0] : null;
};

export default {};
