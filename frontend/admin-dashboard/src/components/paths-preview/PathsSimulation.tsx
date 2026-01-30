/**
 * Paths Simulation Component
 * 
 * Simulates multiple participant sessions to preview path distributions.
 * Uses the same logic as the real experiment runtime to ensure accuracy.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import {
  PlayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  UsersIcon,
  CogIcon,
} from '@heroicons/react/24/outline'

interface PathsSimulationProps {
  experimentId: string
  config?: Record<string, unknown>
}

interface SimulationVariable {
  path: string
  type: 'categorical' | 'numeric' | 'boolean' | 'unknown'
  options?: string[]
  min?: number
  max?: number
  source: string
}

interface VariableDistribution {
  type: string
  distribution?: Record<string, number>
  options?: string[]
  min?: number
  max?: number
  truePercentage?: number
}

interface PathDistribution {
  path: string[]
  pathDisplay: string
  count: number
  percentage: number
  sampleAssignments: Record<string, string>
}

interface SimulationResult {
  totalParticipants: number
  pathDistributions: PathDistribution[]
  variableSummary: Record<string, Record<string, number>>
}

export function PathsSimulation({ experimentId, config }: PathsSimulationProps) {
  // State for variables
  const [variables, setVariables] = useState<SimulationVariable[]>([])
  const [loadingVariables, setLoadingVariables] = useState(true)
  const [variablesError, setVariablesError] = useState<string | null>(null)
  
  // State for simulation config
  const [participantCount, setParticipantCount] = useState(100)
  const [variableDistributions, setVariableDistributions] = useState<Record<string, VariableDistribution>>({})
  
  // State for simulation results
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  
  // UI state
  const [expandedPaths, setExpandedPaths] = useState<Set<number>>(new Set())
  const [showConfigPanel, setShowConfigPanel] = useState(true)

  // Fetch variables on mount
  const fetchVariables = useCallback(async () => {
    setLoadingVariables(true)
    setVariablesError(null)
    
    try {
      const response = await api.get<{ variables: SimulationVariable[] }>(
        `/experiments/${experimentId}/simulate/variables`
      )
      setVariables(response.data.variables)
      
      // Initialize default distributions for each variable
      const defaults: Record<string, VariableDistribution> = {}
      for (const v of response.data.variables) {
        if (v.type === 'categorical' && v.options) {
          // Default to equal distribution
          const dist: Record<string, number> = {}
          const weight = 1 / v.options.length
          for (const opt of v.options) {
            dist[opt] = weight
          }
          defaults[v.path] = { type: 'categorical', distribution: dist }
        } else if (v.type === 'numeric') {
          defaults[v.path] = {
            type: 'numeric',
            min: v.min ?? 0,
            max: v.max ?? 100,
            distribution: 'uniform',
          }
        } else if (v.type === 'boolean') {
          defaults[v.path] = { type: 'boolean', truePercentage: 0.5 }
        }
      }
      setVariableDistributions(defaults)
    } catch (err) {
      console.error('Failed to fetch simulation variables:', err)
      setVariablesError('Failed to load simulation variables')
    } finally {
      setLoadingVariables(false)
    }
  }, [experimentId])

  useEffect(() => {
    fetchVariables()
  }, [fetchVariables, config])

  // Run simulation
  const runSimulation = async () => {
    setRunningSimulation(true)
    setSimulationError(null)
    
    try {
      const response = await api.post<{ simulation: SimulationResult }>(
        `/experiments/${experimentId}/simulate`,
        {
          participant_count: participantCount,
          variable_distributions: variableDistributions,
        }
      )
      setSimulationResult(response.data.simulation)
    } catch (err) {
      console.error('Failed to run simulation:', err)
      setSimulationError('Failed to run simulation')
    } finally {
      setRunningSimulation(false)
    }
  }

  // Toggle path expansion
  const togglePath = (index: number) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // Update categorical distribution
  const updateCategoricalDistribution = (
    varPath: string,
    option: string,
    value: number
  ) => {
    setVariableDistributions(prev => {
      const current = prev[varPath] || { type: 'categorical', distribution: {} }
      const distribution = { ...(current.distribution || {}) }
      distribution[option] = value
      return {
        ...prev,
        [varPath]: { ...current, distribution },
      }
    })
  }

  // Update numeric range
  const updateNumericRange = (
    varPath: string,
    field: 'min' | 'max',
    value: number
  ) => {
    setVariableDistributions(prev => {
      const current = prev[varPath] || { type: 'numeric', min: 0, max: 100 }
      return {
        ...prev,
        [varPath]: { ...current, [field]: value },
      }
    })
  }

  // Update boolean percentage
  const updateBooleanPercentage = (varPath: string, value: number) => {
    setVariableDistributions(prev => ({
      ...prev,
      [varPath]: { type: 'boolean', truePercentage: value },
    }))
  }

  // Group variables by source
  const groupedVariables = variables.reduce((acc, v) => {
    const group = v.path.split('.')[0]
    if (!acc[group]) {
      acc[group] = []
    }
    acc[group].push(v)
    return acc
  }, {} as Record<string, SimulationVariable[]>)

  if (loadingVariables) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <ArrowPathIcon className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-gray-500">Loading simulation configuration...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <UsersIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Path Simulation
          </h2>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfigPanel(!showConfigPanel)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <CogIcon className="w-4 h-4" />
            {showConfigPanel ? 'Hide' : 'Show'} Config
          </button>
          
          <button
            onClick={runSimulation}
            disabled={runningSimulation}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {runningSimulation ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <PlayIcon className="w-4 h-4" />
                Run Simulation
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Config Panel */}
        {showConfigPanel && (
          <div className="w-80 flex-shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Participant Count */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Number of Participants
                </label>
                <input
                  type="number"
                  value={participantCount}
                  onChange={(e) => setParticipantCount(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={10000}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">Max 10,000 participants</p>
              </div>

              {/* Variables */}
              {variablesError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {variablesError}
                </div>
              )}

              {variables.length === 0 && !variablesError && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm rounded-lg">
                  No variables detected in visibility rules or pick conditions.
                  The simulation will show all paths without filtering.
                </div>
              )}

              {Object.entries(groupedVariables).map(([group, vars]) => (
                <div key={group} className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {group === 'participant' ? 'Participant Data' :
                     group === 'session' || group === 'responses' ? 'Step Responses' :
                     group === 'scores' ? 'Computed Scores' :
                     group === 'pick_assigns' ? 'Pick Assignments' :
                     group}
                  </h3>
                  
                  {vars.map((v) => (
                    <VariableConfigInput
                      key={v.path}
                      variable={v}
                      distribution={variableDistributions[v.path]}
                      onCategoricalChange={(opt, val) => updateCategoricalDistribution(v.path, opt, val)}
                      onNumericChange={(field, val) => updateNumericRange(v.path, field, val)}
                      onBooleanChange={(val) => updateBooleanPercentage(v.path, val)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results Panel */}
        <div className="flex-1 overflow-y-auto p-4">
          {simulationError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg flex items-start gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {simulationError}
            </div>
          )}

          {!simulationResult && !runningSimulation && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <UsersIcon className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-lg font-medium">No simulation results yet</p>
              <p className="text-sm">Configure the variables and click "Run Simulation"</p>
            </div>
          )}

          {runningSimulation && (
            <div className="flex flex-col items-center justify-center h-full">
              <ArrowPathIcon className="w-12 h-12 text-indigo-500 animate-spin mb-3" />
              <p className="text-gray-600 dark:text-gray-400">
                Simulating {participantCount} participants...
              </p>
            </div>
          )}

          {simulationResult && !runningSimulation && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Simulation Summary
                </h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Participants:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                      {simulationResult.totalParticipants}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Unique Paths:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                      {simulationResult.pathDistributions.length}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Most Common:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                      {simulationResult.pathDistributions[0]?.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Path Distributions */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Path Distributions
                  </h3>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {simulationResult.pathDistributions.map((dist, index) => (
                    <PathDistributionRow
                      key={index}
                      distribution={dist}
                      index={index}
                      isExpanded={expandedPaths.has(index)}
                      onToggle={() => togglePath(index)}
                      totalParticipants={simulationResult.totalParticipants}
                    />
                  ))}
                </div>
              </div>

              {/* Variable Summary */}
              {Object.keys(simulationResult.variableSummary).length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Generated Variable Distribution
                    </h3>
                  </div>
                  <div className="p-4 space-y-3">
                    {Object.entries(simulationResult.variableSummary).map(([varPath, counts]) => (
                      <div key={varPath} className="text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{varPath}:</span>
                        <div className="ml-4 mt-1 flex flex-wrap gap-2">
                          {Object.entries(counts).map(([value, count]) => (
                            <span
                              key={value}
                              className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs"
                            >
                              {value}: {count} ({((count / simulationResult.totalParticipants) * 100).toFixed(1)}%)
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Variable Config Input Component
interface VariableConfigInputProps {
  variable: SimulationVariable
  distribution?: VariableDistribution
  onCategoricalChange: (option: string, value: number) => void
  onNumericChange: (field: 'min' | 'max', value: number) => void
  onBooleanChange: (value: number) => void
}

function VariableConfigInput({
  variable,
  distribution,
  onCategoricalChange,
  onNumericChange,
  onBooleanChange,
}: VariableConfigInputProps) {
  const varName = variable.path.split('.').slice(-1)[0]
  
  return (
    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {varName}
        <span className="ml-1 text-xs text-gray-400">({variable.type})</span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{variable.path}</div>
      
      {variable.type === 'categorical' && variable.options && (
        <div className="space-y-2">
          {variable.options.map((option) => {
            const value = distribution?.distribution?.[option] ?? (1 / variable.options!.length)
            return (
              <div key={option} className="flex items-center gap-2">
                <span className="w-20 text-xs text-gray-600 dark:text-gray-400 truncate" title={option}>
                  {option}
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={value}
                  onChange={(e) => onCategoricalChange(option, parseFloat(e.target.value))}
                  className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
                <span className="w-12 text-xs text-gray-600 dark:text-gray-400 text-right">
                  {(value * 100).toFixed(0)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
      
      {variable.type === 'numeric' && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-500">Min</label>
            <input
              type="number"
              value={distribution?.min ?? variable.min ?? 0}
              onChange={(e) => onNumericChange('min', parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">Max</label>
            <input
              type="number"
              value={distribution?.max ?? variable.max ?? 100}
              onChange={(e) => onNumericChange('max', parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      )}
      
      {variable.type === 'boolean' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400">True %:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={distribution?.truePercentage ?? 0.5}
            onChange={(e) => onBooleanChange(parseFloat(e.target.value))}
            className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
          <span className="w-12 text-xs text-gray-600 dark:text-gray-400 text-right">
            {((distribution?.truePercentage ?? 0.5) * 100).toFixed(0)}%
          </span>
        </div>
      )}
      
      {variable.type === 'unknown' && (
        <div className="text-xs text-gray-500 italic">
          Type unknown - using default behavior
        </div>
      )}
    </div>
  )
}

// Path Distribution Row Component
interface PathDistributionRowProps {
  distribution: PathDistribution
  index: number
  isExpanded: boolean
  onToggle: () => void
  totalParticipants: number
}

function PathDistributionRow({
  distribution,
  index,
  isExpanded,
  onToggle,
  totalParticipants,
}: PathDistributionRowProps) {
  const barWidth = Math.max(1, (distribution.count / totalParticipants) * 100)
  
  return (
    <div className="group">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
        onClick={onToggle}
      >
        <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          {isExpanded ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronRightIcon className="w-4 h-4" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Path #{index + 1}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({distribution.path.length} steps)
            </span>
          </div>
          
          {/* Distribution bar */}
          <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {distribution.count}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {distribution.percentage.toFixed(1)}%
          </div>
        </div>
      </div>
      
      {isExpanded && (
        <div className="px-4 pb-4 pl-11">
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              Step Sequence
            </h4>
            <div className="flex flex-wrap gap-1">
              {distribution.path.map((step, i) => (
                <React.Fragment key={i}>
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-white dark:bg-gray-600 text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-500">
                    {step}
                  </span>
                  {i < distribution.path.length - 1 && (
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            
            {Object.keys(distribution.sampleAssignments).length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Sample Assignments
                </h4>
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                  {Object.entries(distribution.sampleAssignments).map(([key, value]) => (
                    <div key={key}>
                      <span className="font-medium">{key}:</span> {value}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PathsSimulation

