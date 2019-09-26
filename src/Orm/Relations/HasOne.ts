/*
 * @adonisjs/lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

/// <reference path="../../../adonis-typings/index.ts" />

import {
  ModelOptions,
  ModelContract,
  RelationContract,
  BaseRelationNode,
  ModelConstructorContract,
  ModelQueryBuilderContract,
} from '@ioc:Adonis/Lucid/Model'

import { camelCase, snakeCase, uniq } from 'lodash'
import { Exception } from '@poppinss/utils'

export class HasOne implements RelationContract {
  /**
   * Relationship type
   */
  public type = 'hasOne' as const

  /**
   * The related model from which, we want to construct the relationship
   */
  public relatedModel = this._options.relatedModel!

  /**
   * Local key to use for constructing the relationship
   */
  public localKey: string

  /**
   * Adapter local key
   */
  public localAdapterKey: string

  /**
   * Foreign key referenced by the related model
   */
  public foreignKey: string

  /**
   * Adapter foreign key
   */
  public foreignAdapterKey: string

  /**
   * Key to be used for serializing the relationship
   */
  public serializeAs = this._options.serializeAs || snakeCase(this._relationName)

  /**
   * A flag to know if model keys valid for executing database queries or not
   */
  private _isValid: boolean = false

  constructor (
    private _relationName: string,
    private _options: Partial<BaseRelationNode>,
    private _model: ModelConstructorContract,
  ) {
    this._validateOptions()
    this._computeKeys()
  }

  /**
   * Ensure that related model is defined, otherwise raise an exception, since
   * a relationship cannot work with a single model.
   */
  private _validateOptions () {
    if (!this._options.relatedModel) {
      throw new Exception(
        'Related model reference is required for construct relationship',
        500,
        'E_MISSING_RELATED_MODEL',
      )
    }
  }

  /**
   * Compute keys
   */
  private _computeKeys () {
    if (this._isValid) {
      return
    }

    this.localKey = this._options.localKey || this._model.$primaryKey
    this.foreignKey = this._options.foreignKey || camelCase(`${this._model.name}_${this._model.$primaryKey}`)

    /**
     * Validate computed keys to ensure they are valid
     */
    this._validateKeys()

    /**
     * Keys for the adapter
     */
    this.localAdapterKey = this._model.$getColumn(this.localKey)!.castAs
    this.foreignAdapterKey = this.relatedModel().$getColumn(this.foreignKey)!.castAs
  }

  /**
   * Validating the keys to ensure we are avoiding runtime `undefined` errors. We defer
   * the keys validation, since they may be added after defining the relationship.
   */
  private _validateKeys () {
    const relationRef = `${this._model.name}.${this._relationName}`

    if (!this._model.$hasColumn(this.localKey)) {
      const ref = `${this._model.name}.${this.localKey}`
      throw new Exception(
        `${ref} required by ${relationRef} relation is missing`,
        500,
        'E_MISSING_RELATED_LOCAL_KEY',
      )
    }

    if (!this.relatedModel().$hasColumn(this.foreignKey)) {
      const ref = `${this.relatedModel().name}.${this.foreignKey}`
      throw new Exception(
        `${ref} required by ${relationRef} relation is missing`,
        500,
        'E_MISSING_RELATED_FOREIGN_KEY',
      )
    }

    this._isValid = true
  }

  /**
   * Sets the related model instances
   */
  private _setRelated (model: ModelContract, related?: ModelContract | null) {
    if (!related) {
      return
    }

    model.$setRelated(this._relationName as keyof typeof model, related)
  }

  /**
   * Raises exception when value for the local key is missing on the model instance. This will
   * make the query fail
   */
  private _ensureValue (value: any) {
    if (value === undefined) {
      throw new Exception(
        `Cannot preload ${this._relationName}, value of ${this._model.name}.${this.localKey} is undefined`,
        500,
      )
    }

    return value
  }

  /**
   * Execute hasOne and set the relationship on model(s)
   */
  public async exec (
    parentInstances: ModelContract | ModelContract[],
    options?: ModelOptions,
    userCallback?: (builder: ModelQueryBuilderContract<any>) => void,
  ) {
    const query = this.relatedModel().query(options)
    if (typeof (userCallback) === 'function') {
      userCallback(query)
    }

    if (Array.isArray(parentInstances)) {
      const values = uniq(parentInstances.map((parentInstance) => {
        return this._ensureValue(parentInstance[this.localKey])
      }))
      const result = await query.whereIn(this.foreignAdapterKey, values).exec()

      /**
       * Instead of looping over the model instances, we loop over the related model instances, since
       * it can improve performance in some case. For example:
       *
       * - There are 10 parentInstances and we all of them to have one related instance, in
       *   this case we run 10 iterations.
       * - There are 10 parentInstances and 8 of them have related instance, in this case we run 8
       *   iterations vs 10.
       */
      result.forEach((one) => {
        const related = parentInstances.find((model) => model[this.localKey] === one[this.foreignKey])
        if (related) {
          this._setRelated(related, one)
        }
      })
    } else {
      const value = parentInstances[this.localKey]
      const result = await query.where(this.foreignAdapterKey, this._ensureValue(value)).first()
      this._setRelated(parentInstances, result)
    }
  }
}
