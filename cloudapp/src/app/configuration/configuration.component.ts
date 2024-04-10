import { Component, OnInit } from '@angular/core';
import { AppService} from '../app.service';
import { FormGroup } from '@angular/forms';
import { AlertService, CloudAppSettingsService, FormGroupUtil } from '@exlibris/exl-cloudapp-angular-lib';
import { Configuration } from '../models/configuration';
import { PartnerCodeService } from '../app.service';

@Component({
  selector: 'app-configuration',
  templateUrl: './configuration.component.html',
  styleUrls: ['./configuration.component.scss']
})
export class ConfigurationComponent implements OnInit {
  form: FormGroup;
  saving = false;
  partnerCode : string;
  constructor(
    private appService: AppService,
    private settingsService: CloudAppSettingsService,
    private alert: AlertService,
    private partnerCodeService: PartnerCodeService,
  ) { }

  ngOnInit(): void {
    this.partnerCode = this.partnerCodeService.getPartnerCode()
    this.appService.setTitle('Configuration');
    this.settingsService.get().subscribe( settings => {
      this.form = FormGroupUtil.toFormGroup(Object.assign(new Configuration(), settings))
    });
  }
  save() {
    this.saving = true;
    this.partnerCode = this.form.value.partnerCode
    this.partnerCodeService.setPartnerCode(this.partnerCode)
    this.settingsService.set(this.form.value).subscribe(
    response => {
      this.alert.success('Configuration successfully saved.');
    },
    err => this.alert.error(err.message),
    ()  => this.saving = false
  );
}


}
