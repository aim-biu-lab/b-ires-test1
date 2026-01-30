
Experiment stages requirements:

The experiment should be easily configarable from yaml files - stages, sub-stages/questionnaires, etc.

Each stage defined in the yaml file could be mandatory or skipable. It could be visible or hidden for all. Also list of rules by which the stage or sub-stage will be shown to some users and will not to others, for example: If the user chose option A on the stage X, so the stage Y and Z will be visible to him, otherwise (option B) - only Z will be presented to him. Or if the user came via specific link with parameter value A or B, etc.

The system should be planned in a way that the stages and sub-stages will easily be configarable, easily reordarable (that the experiment builder developer could easily change the order or stages/sub-stages).

Each stage could involve multiple sub-stages. Sub-stage could be a block of questionnaire, text with html formatting, image, video, html page with javascript or iframe.

Each stage/sub-stage config should specify whether its visible before the previous is completed (submitted) and if it dissapears after submission. In addition, we could specify whether the stage/sub-stage is editable after a submission (otherwise the user cannot modify the selection/answer made, even if visible).



Api requirements:

Each Stage/sub-stage block should be able to "talk" to the current experiment session, which is required for proper syncronization. For example, an integrated block, with which the user is interacting, should be able to update the experiment manager that the block is complete, in order to go to the next sub-stage/stage in the inclusive shell. Or the system should be able to tell the block - start playing, etc.



Questionnaire sub-stage requirements:

The questions and possible answers will be defined in yaml config files. The system should read them and present to the user the most updated version.

Each question/question-answer should get its own id for logging, that will be taken from the config files. Each question could be with specified possible answers to answer (radio or multiple choice select input) or with input textarea/html input, or html select field. The question could be marked as completing the stage or sub-stage.

Also a special, likert skale, question-answers required. Each answer should be nicely presented as faces, going from 1 to 5 or from 1 to 7 (configurable via yaml).



Gui requirements:

Each stage, button or other gui element should get its own, unique id for logging.

In every step, the user can clearly see current progress (stage 1 of 3, question 5 of 10, etc).



Loging system requirements:

Each stage, element, experimentor will get unique id, which in combination will give use the unique id for each experiment.

Log system should store for each experimentor (which will get its unique ID) all his actions (clicks/actions on diferent elements, chosed answers for each question, submited answers for each question, timestamp of each action, etc). Separate db should be used for experimentors mapping (their ids and demographic info, experiment start, progress (updated in real time on each stage/question answer submission)).

All logs should be saved in realtime to two places. One is mongodb, locally running, and the other is csv file, for backup. The experiment running developers should be able easily retrieve the stored logs, statistics, in real time, and be able to run a simple requests to the DB with different prompts.

