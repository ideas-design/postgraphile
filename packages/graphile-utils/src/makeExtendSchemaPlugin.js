export default function makeExtendSchemaPlugin(
  generator,
  uniqueId = String(Math.random()).substr(2)
) {
  return builder => {
    // Add stuff to the schema
    builder.hook("build", build => {
      const {
        graphql: { GraphQLInputObjectType, GraphQLObjectType },
      } = build;
      const { typeDefs, resolvers = {} } = generator(build);
      if (!typeDefs || !typeDefs.kind === "Document") {
        throw new Error(
          "The first argument to makeExtendSchemaPlugin must be generated by the `gql` helper"
        );
      }
      const typeExtensions = {
        GraphQLInputObjectType: {},
        GraphQLObjectType: {},
      };
      const newTypes = [];
      typeDefs.definitions.forEach(definition => {
        if (definition.kind === "ObjectTypeExtension") {
          const name = getName(definition.name);
          if (!typeExtensions.GraphQLObjectType[name]) {
            typeExtensions.GraphQLObjectType[name] = [];
          }
          typeExtensions.GraphQLObjectType[name].push(definition);
        } else if (definition.kind === "InputObjectTypeExtension") {
          const name = getName(definition.name);
          if (!typeExtensions.GraphQLInputObjectType[name]) {
            typeExtensions.GraphQLInputObjectType[name] = [];
          }
          typeExtensions.GraphQLInputObjectType[name].push(definition);
        } else if (definition.kind === "ObjectTypeDefinition") {
          newTypes.push({
            type: GraphQLObjectType,
            definition,
          });
        } else if (definition.kind === "InputObjectTypeDefinition") {
          newTypes.push({
            type: GraphQLInputObjectType,
            definition,
          });
        } else {
          throw new Error(
            `Unexpected '${
              definition.kind
            }' definition; we were expecting 'ObjectTypeExtension', 'InputObjectTypeExtension', 'ObjectTypeDefinition' or 'InputObjectTypeDefinition', i.e. something like 'extend type Foo { ... }'`
          );
        }
      });
      return build.extend(build, {
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
        [`ExtendSchemaPlugin_${uniqueId}_newTypes`]: newTypes,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
      });
    });

    builder.hook("init", (_, build, _context) => {
      const {
        newWithHooks,
        [`ExtendSchemaPlugin_${uniqueId}_newTypes`]: newTypes,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
        graphql: { GraphQLObjectType, GraphQLInputObjectType },
      } = build;
      newTypes.forEach(({ type, definition }) => {
        if (type === GraphQLObjectType) {
          const name = getName(definition.name);
          const description = getDescription(definition.description);
          const interfaces = getInterfaces(definition.interfaces, build);
          const directives = getDirectives(definition.directives);
          const scope = {
            directives,
            ...(directives.scope || {}),
          };
          newWithHooks(
            type,
            {
              name,
              interfaces,
              fields: ({
                Self,
                fieldWithHooks,
                recurseDataGeneratorsForField,
              }) =>
                getFields(
                  Self,
                  definition.fields,
                  resolvers,
                  { fieldWithHooks, recurseDataGeneratorsForField },
                  build
                ),
              ...(description
                ? {
                    description,
                  }
                : null),
            },
            scope
          );
        } else if (type === GraphQLInputObjectType) {
          const name = getName(definition.name);
          const description = getDescription(definition.description);
          const directives = getDirectives(definition.directives);
          const scope = {
            directives,
            ...(directives.scope || {}),
          };
          newWithHooks(
            type,
            {
              name,
              fields: ({ Self }) =>
                getInputFields(Self, definition.fields, build),
              ...(description
                ? {
                    description,
                  }
                : null),
            },
            scope
          );
        } else {
          throw new Error("Coding error.");
        }
      });
      return _;
    });

    builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
      const {
        extend,
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
      } = build;
      const { Self, fieldWithHooks, recurseDataGeneratorsForField } = context;
      if (typeExtensions.GraphQLObjectType[Self.name]) {
        const newFields = typeExtensions.GraphQLObjectType[Self.name].reduce(
          (memo, extension) => {
            const moreFields = getFields(
              Self,
              extension.fields,
              resolvers,
              { fieldWithHooks, recurseDataGeneratorsForField },
              build
            );
            return extend(memo, moreFields);
          },
          {}
        );
        return extend(fields, newFields);
      } else {
        return fields;
      }
    });

    builder.hook("GraphQLInputObjectType:fields", (fields, build, context) => {
      const {
        extend,
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
      } = build;
      const { Self } = context;
      if (typeExtensions.GraphQLInputObjectType[Self.name]) {
        const newFields = typeExtensions.GraphQLInputObjectType[
          Self.name
        ].reduce((memo, extension) => {
          const moreFields = getInputFields(Self, extension.fields, build);
          return extend(memo, moreFields);
        }, {});
        return extend(fields, newFields);
      } else {
        return fields;
      }
    });
  };
}

function getName(name) {
  if (name && name.kind === "Name" && name.value) {
    return name.value;
  }
  throw new Error("Could not extract name from AST");
}

function getDescription(desc) {
  if (!desc) {
    return null;
  } else if (desc.kind === "StringValue") {
    return desc.value;
  } else {
    throw new Error(
      `AST issue, we weren't expecting a description of kind '${
        desc.kind
      }' - PRs welcome!`
    );
  }
}

function getType(type, build) {
  if (type.kind === "NamedType") {
    const Type = build.getTypeByName(getName(type.name));
    if (!Type) {
      throw new Error(`Could not find type named '${getName(type.name)}'.`);
    }
    return Type;
  } else if (type.kind === "NonNullType") {
    return new build.graphql.GraphQLNonNull(getType(type.type, build));
  } else if (type.kind === "ListType") {
    return new build.graphql.GraphQLList(getType(type.type, build));
  } else {
    throw new Error(
      `We don't support AST type definition of kind '${
        type.kind
      }' yet... PRs welcome!`
    );
  }
}

function getInterfaces(interfaces, _build) {
  if (interfaces.length) {
    throw new Error(
      `We don't support interfaces via makeExtendSchemaPlugin yet; PRs welcome!`
    );
  }
  return [];
}

function getValue(value) {
  if (value.kind === "BooleanValue") {
    return !!value.value;
  } else if (value.kind === "StringValue") {
    return value.value;
  } else if (value.kind === "IntValue") {
    return parseInt(value.value, 10);
  } else if (value.kind === "FloatValue") {
    return parseFloat(value.value);
  } else if (value.kind === "NullValue") {
    return null;
  } else if (value.kind === "GraphileEmbed") {
    // RAW!
    return value.value;
  } else {
    throw new Error(
      `Value kind '${value.kind}' not supported yet. PRs welcome!`
    );
  }
}

function getDirectives(directives) {
  return (directives || []).reduce((memo, directive) => {
    if (directive.kind === "Directive") {
      const name = getName(directive.name);
      const value = directive.arguments.reduce((memo, arg) => {
        if (arg.kind === "Argument") {
          const argName = getName(arg.name);
          const argValue = getValue(arg.value);
          if (memo[name]) {
            throw new Error(
              `Argument '${argName}' of directive '${name}' must only be used once.`
            );
          }
          memo[argName] = argValue;
        } else {
          throw new Error(
            `Unexpected '${arg.kind}', we were expecting 'Argument'`
          );
        }
        return memo;
      }, {});
      if (memo[name]) {
        throw new Error(
          `Directive '${name}' must only be used once per field.`
        );
      }
      memo[name] = value;
    } else {
      throw new Error(
        `Unexpected '${directive.kind}', we were expecting 'Directive'`
      );
    }
    return memo;
  }, {});
}

function getArguments(args, build) {
  if (args && args.length) {
    return args.reduce((memo, arg) => {
      if (arg.kind === "InputValueDefinition") {
        const name = getName(arg.name);
        const type = getType(arg.type, build);
        const description = getDescription(arg.description);
        let defaultValue;
        if (arg.defaultValue) {
          defaultValue = getValue(arg.defaultValue);
        }
        memo[name] = {
          type,
          ...(defaultValue ? { defaultValue } : null),
          ...(description ? { description } : null),
        };
      } else {
        throw new Error(
          `Unexpected '${
            arg.kind
          }', we were expecting an 'InputValueDefinition'`
        );
      }
      return memo;
    }, {});
  }
  return {};
}

function getFields(
  Self,
  fields,
  resolvers,
  { fieldWithHooks, recurseDataGeneratorsForField },
  build
) {
  const { parseResolveInfo, pgQueryFromResolveData, pgSql: sql } = build;
  function augmentResolver(resolver, fieldScope) {
    const { getDataFromParsedResolveInfoFragment } = fieldScope;
    return (parent, args, context, resolveInfo) => {
      const selectGraphQLResultFromTable = async (
        tableFragment,
        builderCallback
      ) => {
        const { pgClient } = context;
        const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
        const PayloadType = resolveInfo.returnType;
        const resolveData = getDataFromParsedResolveInfoFragment(
          parsedResolveInfoFragment,
          PayloadType
        );
        const tableAlias = sql.identifier(Symbol());
        const query = pgQueryFromResolveData(
          tableFragment,
          tableAlias,
          resolveData,
          {},
          sqlBuilder => builderCallback(tableAlias, sqlBuilder)
        );
        const { text, values } = sql.compile(query);
        const { rows } = await pgClient.query(text, values);
        return rows;
      };
      return resolver(parent, args, context, resolveInfo, {
        ...fieldScope,
        selectGraphQLResultFromTable,
      });
    };
  }
  if (fields && fields.length) {
    return fields.reduce((memo, field) => {
      if (field.kind === "FieldDefinition") {
        const description = getDescription(field.description);
        const fieldName = getName(field.name);
        const args = getArguments(field.arguments, build);
        const type = getType(field.type, build);
        const directives = getDirectives(field.directives);
        const scope = {
          fieldDirectives: directives,
          ...(directives.scope || {}),
        };
        const deprecationReason =
          directives.deprecated && directives.deprecated.reason;
        const functionToResolveObject = functionOrResolveObject =>
          typeof functionOrResolveObject === "function"
            ? { resolve: functionOrResolveObject }
            : functionOrResolveObject;
        /*
         * We accept a resolver function directly, or an object which can
         * define 'resolve', 'subscribe' and other relevant methods.
         */
        const rawResolversSpec =
          functionToResolveObject(
            resolvers[Self.name] && resolvers[Self.name][fieldName]
          ) || null;
        if (directives.recurseDataGenerators) {
          recurseDataGeneratorsForField(fieldName);
        }
        memo[fieldName] = fieldWithHooks(
          fieldName,
          fieldScope => {
            const resolversSpec = Object.keys(rawResolversSpec || {}).reduce(
              (memo, key) => {
                if (typeof rawResolversSpec[key] === "function") {
                  memo[key] = augmentResolver(
                    rawResolversSpec[key],
                    fieldScope
                  );
                }
                return memo;
              },
              {}
            );
            return {
              type,
              args,
              ...(deprecationReason
                ? {
                    deprecationReason,
                  }
                : null),
              ...(description
                ? {
                    description,
                  }
                : null),
              ...resolversSpec,
            };
          },
          scope
        );
      } else {
        throw new Error(
          `AST issue: expected 'FieldDefinition', instead received '${
            field.kind
          }'`
        );
      }
      return memo;
    }, {});
  }
  return {};
}

function getInputFields(Self, fields, build) {
  if (fields && fields.length) {
    return fields.reduce((memo, field) => {
      if (field.kind === "InputValueDefinition") {
        const description = getDescription(field.description);
        const fieldName = getName(field.name);
        const type = getType(field.type, build);
        memo[fieldName] = {
          type,
          // defaultValue
          ...(description
            ? {
                description,
              }
            : null),
        };
      } else {
        throw new Error(
          `AST issue: expected 'FieldDefinition', instead received '${
            field.kind
          }'`
        );
      }
      return memo;
    }, {});
  }
  return {};
}
