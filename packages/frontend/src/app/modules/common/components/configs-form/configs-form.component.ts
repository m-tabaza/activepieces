import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  ControlValueAccessor,
  UntypedFormBuilder,
  UntypedFormControl,
  UntypedFormGroup,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';
import {
  ActionMetaService,
  DropdownState,
} from 'packages/frontend/src/app/modules/flow-builder/service/action-meta.service';
import { fadeInUp400ms } from '../../animation/fade-in-up.animation';
import { ThemeService } from '../../service/theme.service';
import { PieceConfig } from './connector-action-or-config';
import { DropdownItem } from '../../model/dropdown-item.interface';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { BuilderSelectors } from 'packages/frontend/src/app/modules/flow-builder/store/builder/builder.selector';
import deepEqual from 'deep-equal';
import { CodemirrorComponent } from '@ctrl/ngx-codemirror';
import { InsertMentionOperation } from '../form-controls/interpolating-text-form-control/utils';
import { jsonValidator } from '../../validators/json-validator';
import { CodeService } from '../../../flow-builder/service/code.service';
import { PropertyType } from 'packages/pieces/src/lib/framework/property';
type ConfigKey = string;

@Component({
  selector: 'app-configs-form',
  templateUrl: './configs-form.component.html',
  styleUrls: ['./configs-form.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: ConfigsFormComponent,
    },
    {
      provide: NG_VALIDATORS,
      multi: true,
      useExisting: ConfigsFormComponent,
    },
  ],
  animations: [fadeInUp400ms],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigsFormComponent implements ControlValueAccessor {
  updateValueOnChange$: Observable<void> = new Observable<void>();
  PropertyType = PropertyType;
  optionsObservables$: {
    [key: ConfigKey]: Observable<DropdownState<any>>;
  } = {};
  dropdownsLoadingFlags$: { [key: ConfigKey]: Observable<boolean> } = {};
  allAuthConfigs$: Observable<DropdownItem[]>;
  configDropdownChanged$: Observable<any>;
  cloudAuthCheck$: Observable<void>;
  editorOptions = {
    lineNumbers: true,
    theme: 'lucario',
    mode: 'javascript',
  };
  faInfoCircle = faInfoCircle;
  checkingOAuth2CloudManager = false;
  configs: PieceConfig[] = [];
  requiredConfigs: PieceConfig[] = [];
  allOptionalConfigs: PieceConfig[] = [];
  selectedOptionalConfigs: PieceConfig[] = [];
  optionalConfigsMenuOpened = false;
  @Input() stepName: string;
  @Input() pieceName: string;
  @Input() pieceDisplayName: string;
  form!: UntypedFormGroup;
  OnChange = (value) => { ; };
  OnTouched = () => { ; };


  constructor(
    private fb: UntypedFormBuilder,
    public themeService: ThemeService,
    private actionMetaDataService: ActionMetaService,
    private store: Store,
    private codeService: CodeService
  ) {
    this.allAuthConfigs$ = this.store.select(
      BuilderSelectors.selectAppConnectionsDropdownOptions
    );
  }

  writeValue(obj: PieceConfig[]): void {
    this.configs = obj;
    this.createForm();
  }
  registerOnChange(fn: any): void {
    this.OnChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.OnTouched = fn;
  }
  setDisabledState(disabled: boolean) {
    if (disabled) {
      this.form.disable();
    } else {
      this.form.enable();
    }
  }
  validate() {
    if (this.form.invalid) {
      return { invalid: true };
    }
    return null;
  }
  createForm() {
    this.requiredConfigs = this.configs.filter((c) => c.required);
    this.allOptionalConfigs = this.configs.filter((c) => !c.required);

    this.selectedOptionalConfigs = this.allOptionalConfigs.filter(
      (c) => c.value !== undefined
    );
    const requiredConfigsControls = this.createConfigsFormControls(
      this.requiredConfigs
    );
    const optionalConfigsControls = this.createConfigsFormControls(
      this.selectedOptionalConfigs
    );
    this.form = this.fb.group({
      ...requiredConfigsControls,
      ...optionalConfigsControls,
    });
    this.createDropdownConfigsObservables();
    this.updateValueOnChange$ = this.form.valueChanges.pipe(
      tap((value) => {
        this.OnChange(this.formValueMiddleWare(value));
      }),
      map(() => void 0)
    );

    this.form.markAllAsTouched();
  }

  createDropdownConfigsObservables() {
    this.configs.forEach((c) => {
      if (c.type === PropertyType.DROPDOWN) {
        const refreshers$ = {};
        c.refreshers!.forEach((r) => {
          refreshers$[r] = this.form.controls[r].valueChanges.pipe(
            distinctUntilChanged((prev, curr) => {
              return JSON.stringify(prev) === JSON.stringify(curr);
            }),
            startWith(this.configs.find((c) => c.key === r)!.value),
            debounceTime(150)
          );
        });
        if (c.refreshers!.length === 0) {
          refreshers$['oneTimeRefresh'] = of(true);
        }
        this.optionsObservables$[c.key] = combineLatest(refreshers$).pipe(
          switchMap((res) => {
            return this.store
              .select(BuilderSelectors.selectCurrentCollection)
              .pipe(
                take(1),
                switchMap((collection) => {
                  return this.actionMetaDataService.getPieceActionConfigOptions(
                    {
                      propertyName: c.key,
                      stepName: this.stepName,
                      input: res,
                      collectionVersionId: collection.version!.id,
                    },
                    this.pieceName
                  );
                })
              );
          }),
          shareReplay(1),
          catchError((err) => {
            console.error(err);
            return of({
              options: [],
              disabled: true,
              placeholder: 'unknown server erro happend, check console',
            });
          })
        );
        this.dropdownsLoadingFlags$[c.key] = this.optionsObservables$[
          c.key
        ].pipe(
          startWith(null),
          map((val) => {
            if (val === null) return true;
            if (!Array.isArray(val.options)) {
              console.error(
                `Activepieces- Config ${c.label} options are not returned in array form--> ${val}`
              );
            }
            return false;
          })
        );
      }
    });
  }

  private createConfigsFormControls(configs: PieceConfig[]) {
    const controls: { [key: string]: UntypedFormControl } = {};
    configs.forEach((c) => {
      const validators: ValidatorFn[] = [];
      if (c.required) {
        validators.push(Validators.required);
      }
      if (c.type === PropertyType.OBJECT) {
        controls[c.key] = new UntypedFormControl(c.value || {}, validators);
      } else if (c.type === PropertyType.ARRAY) {
        controls[c.key] = new UntypedFormControl(c.value || [''], validators);
      } else if (c.type === PropertyType.JSON) {
        validators.push(jsonValidator);
        if (typeof c.value === "object") {
          controls[c.key] = new UntypedFormControl(JSON.stringify(c.value), validators);
        }
        else {
          controls[c.key] = new UntypedFormControl(c.value || "{}", validators);
        }
      }
      else {
        controls[c.key] = new UntypedFormControl(c.value, validators);
      }

    });
    return controls;
  }
  getControl(configKey: string) {
    return this.form.get(configKey);
  }

  removeConfig(config: PieceConfig) {
    this.form.removeControl(config.key);
    const configIndex = this.allOptionalConfigs.findIndex((c) => c === config);
    this.selectedOptionalConfigs.splice(configIndex, 1);
  }

  addOptionalConfig(config: PieceConfig) {
    this.form.addControl(config.key, new UntypedFormControl());
    this.selectedOptionalConfigs.push(config);
  }


  connectionValueChanged(event: { configKey: string, value: `\${connections.${string}}` }) {
    debugger;
    this.form.get(event.configKey)!.setValue(event.value);
  }
  dropdownCompareWithFunction = (opt: string, formControlValue: string) => {
    return formControlValue !== undefined && deepEqual(opt, formControlValue);
  };

  addMentionToJsonControl(jsonControl: CodemirrorComponent, mention: InsertMentionOperation) {
    const doc = jsonControl.codeMirror!.getDoc();
    const cursor = doc.getCursor();
    doc.replaceRange(mention.insert.mention.serverValue, cursor);
  }

  formValueMiddleWare(formValue: object) {
    const formattedValue = { ...formValue };
    Object.keys(formValue).forEach(configKey => {
      if (this.configs.find(c => c.key === configKey)!.type === PropertyType.JSON) {
        try {
          formattedValue[configKey] = JSON.parse(formValue[configKey]);
        } catch (_) { ; }
      }
    });
    return formattedValue;
  }

  beautify(configKey: string) {
    try {
      const ctrl = this.form.get(configKey)!;
      ctrl.setValue(this.codeService.beautifyJson(JSON.parse(ctrl.value)));
    } catch { ; }
  }
}
